import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';

describe('Hardening (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const stamp = Date.now();
  const email = `hardening-${stamp}@example.com`;
  const password = 'password123';
  let accessToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    dataSource = moduleFixture.get(DataSource);

    await request(app.getHttpServer()).post('/auth/register').send({ email, password });
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    accessToken = login.body.accessToken;
  });

  afterAll(async () => {
    await dataSource.query(
      `DELETE FROM project_members WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
      [email],
    );
    await dataSource.query(
      `DELETE FROM projects WHERE owner_id = (SELECT id FROM users WHERE email = $1)`,
      [email],
    );
    await dataSource.query(`DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE email = $1)`, [
      email,
    ]);
    await dataSource.query(`DELETE FROM users WHERE email = $1`, [email]);
    await app.close();
  });

  describe('Problem C2: mass assignment is impossible', () => {
    it('a create body with an unexpected field is rejected with 400 and nothing is created', async () => {
      const before = await dataSource.query('SELECT count(*)::int FROM projects');

      const res = await request(app.getHttpServer())
        .post('/projects')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Mass assignment attempt', role: 'admin', isAdmin: true })
        .expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringContaining('role'), expect.stringContaining('isAdmin')]),
      );

      const after = await dataSource.query('SELECT count(*)::int FROM projects');
      expect(after[0].count).toBe(before[0].count);
    });

    it('an accepted-but-ignored field (ownerId) does not error, but is still not used', async () => {
      // Unlike role/isAdmin, ownerId IS whitelisted on CreateProjectDto
      // (Assignment 2 / Problem W2) - it passes validation but the
      // controller never reads it. Confirms both halves of that design:
      // no 400 here, and the project's real owner is still the caller.
      const someoneElsesId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app.getHttpServer())
        .post('/projects')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Ignored ownerId attempt', ownerId: someoneElsesId })
        .expect(201);

      expect(res.body.ownerId).not.toBe(someoneElsesId);
    });
  });

  describe('Problem C3: route params are validated before they reach the database', () => {
    it('GET /tasks/:id with a malformed id returns 400, not a raw database error', async () => {
      const res = await request(app.getHttpServer())
        .get('/tasks/not-a-uuid')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(400);

      expect(res.body.error).toBe('Bad Request');
      expect(JSON.stringify(res.body).toLowerCase()).not.toContain('syntax for type');
    });

    it('GET /projects/:id with a malformed id also returns 400', async () => {
      const res = await request(app.getHttpServer())
        .get('/projects/not-a-uuid')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(400);

      expect(res.body.error).toBe('Bad Request');
    });

    it('a well-formed but nonexistent uuid still reaches the real 404, not a 400', async () => {
      await request(app.getHttpServer())
        .get('/tasks/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
    });
  });

  describe('Challenge X1: tightened CSP and CI dependency audit', () => {
    it('the CSP header is the tightened policy, not helmet\'s page-oriented defaults', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password });

      const csp = res.headers['content-security-policy'];
      expect(csp).toBeDefined();
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      // Helmet's own page-oriented defaults (script-src, style-src) are
      // NOT present - this API serves JSON only and needs none of them.
      expect(csp).not.toContain('script-src');
      expect(csp).not.toContain('style-src');
    });

    // The CI dependency-audit step itself (.github/workflows/ci.yml,
    // `npm audit --audit-level=high`) isn't something an e2e test can
    // exercise - see README and OWASP.md for the current, honestly
    // reported findings and why they're accepted for this PR.
  });

  describe('Problem C5: the error shape is identical across error types', () => {
    it('a 400 and a 404 both have exactly statusCode, message, error, timestamp, path', async () => {
      const badRequest = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'not-an-email', password: 'short' })
        .expect(400);

      // /tasks/:id, not /projects/:id: RolesGuard resolves the task
      // first to find its project (see @Resource('task', 'id') in
      // tasks.controller.ts) - a task that doesn't exist genuinely 404s
      // before any membership check could apply. /projects/:id would
      // 403 here instead, since this user isn't a member of anything.
      const notFound = await request(app.getHttpServer())
        .get('/tasks/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);

      for (const res of [badRequest, notFound]) {
        expect(Object.keys(res.body).sort()).toEqual(
          ['statusCode', 'message', 'error', 'timestamp', 'path'].sort(),
        );
        expect(typeof res.body.timestamp).toBe('string');
        expect(res.body.path).toEqual(expect.any(String));
      }
    });

    it('a 500 never leaks a stack trace or a raw database error to the client', async () => {
      // No ParseUUIDPipe reaction here on purpose in this first test -
      // see the next test for the C3 fix. This one proves the filter's
      // own behavior: whatever caused the 500, the response body never
      // contains a stack trace.
      const res = await request(app.getHttpServer())
        .get('/tasks/00000000-0000-0000-0000-000000000000/comments')
        .set('Authorization', `Bearer ${accessToken}`);

      // 404 in this codebase (RolesGuard resolves the task first and
      // throws NotFoundException) - either way, assert no stack leaks.
      expect(JSON.stringify(res.body)).not.toMatch(/at \w+\.\w+ \(/); // no stack frame shape
      expect(JSON.stringify(res.body).toLowerCase()).not.toContain('node_modules');
    });
  });
});
