import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';

/**
 * Requires a real Postgres database with the migrations already applied
 * (see README: "Running the tests"). This test owns one throwaway user,
 * created and deleted around the suite, so it can run repeatedly without
 * manual cleanup.
 */
describe('Auth (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  const testEmail = `e2e-auth-${Date.now()}@example.com`;
  const testPassword = 'correct-horse-battery-staple';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    dataSource = moduleFixture.get(DataSource);
  });

  afterAll(async () => {
    await dataSource.query('DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE email = $1)', [
      testEmail,
    ]);
    await dataSource.query('DELETE FROM users WHERE email = $1', [testEmail]);
    await app.close();
  });

  it('registers a user without leaking the password or hash', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: testEmail, password: testPassword })
      .expect(201);

    expect(res.body.password).toBeUndefined();
    expect(res.body.passwordHash).toBeUndefined();
    expect(res.body.email).toBe(testEmail);
  });

  it('rejects a wrong password with 401', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: testEmail, password: 'not-the-password' })
      .expect(401);
  });

  it('rejects an unknown email with the identical 401 body', async () => {
    const wrongPassword = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: testEmail, password: 'not-the-password' });

    const unknownEmail = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'definitely-not-registered@example.com', password: 'whatever' });

    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.body.message).toEqual(wrongPassword.body.message);
  });

  it('logs in and returns an access/refresh pair', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: testEmail, password: testPassword })
      .expect(200);

    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
  });

  it('rotates on refresh: the old refresh token stops working, the new one works', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: testEmail, password: testPassword })
      .expect(200);

    const tokenA = login.body.refreshToken;

    const rotatedOnce = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: tokenA })
      .expect(200);
    const tokenB = rotatedOnce.body.refreshToken;
    expect(tokenB).not.toBe(tokenA);

    // The freshly issued token must work on its own next rotation - this
    // is checked *before* tokenA is ever presented again, so this result
    // is about rotation producing a genuinely usable token, not about
    // reuse detection (Challenge X1 covers that scenario on its own,
    // below, where presenting tokenA again is the point of the test).
    const rotatedTwice = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: tokenB })
      .expect(200);
    expect(rotatedTwice.body.refreshToken).not.toBe(tokenB);

    // Presenting the original, already-rotated tokenA is rejected.
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: tokenA })
      .expect(401);
  });

  it('logout revokes the refresh token so a later refresh returns 401', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: testEmail, password: testPassword })
      .expect(200);

    await request(app.getHttpServer())
      .post('/auth/logout')
      .send({ refreshToken: login.body.refreshToken })
      .expect(204);

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(401);
  });

  it('(Challenge X1) reusing a revoked refresh token revokes its whole family', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: testEmail, password: testPassword })
      .expect(200);

    const tokenA = login.body.refreshToken;

    // Rotate once: A is revoked, B is issued in the same family.
    const rotated = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: tokenA })
      .expect(200);
    const tokenB = rotated.body.refreshToken;

    // Present the now-revoked A again - a thief replaying a stolen token.
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: tokenA })
      .expect(401);

    // The legitimate client's own next-in-line token, B, must now be dead
    // too - reuse of an earlier link in the chain ends the whole family.
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: tokenB })
      .expect(401);
  });

  it('(Challenge X2) rejects an expired refresh token that was never revoked', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: testEmail, password: testPassword })
      .expect(200);

    // Manufacture expiry directly: back-date the row's expires_at without
    // touching revoked_at, so only the expiry check can be the cause of
    // the 401 that follows.
    await dataSource.query(
      `UPDATE refresh_tokens
       SET expires_at = now() - interval '1 minute'
       WHERE user_id = (SELECT id FROM users WHERE email = $1)
         AND revoked_at IS NULL`,
      [testEmail],
    );

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(401);
  });
});
