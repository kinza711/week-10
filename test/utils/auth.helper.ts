import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';

interface TestUser {
  email: string;
  password: string;
}

let counter = 0;

/** A fresh, unique user every call -- so tests never collide on the unique email constraint. */
export function buildUser(overrides: Partial<TestUser> = {}): TestUser {
  counter += 1;
  return {
    email: `test.user.${counter}.${Date.now()}@example.com`,
    password: 'Password123!',
    ...overrides,
  };
}

/** Registers + logs in one user. Matches your real /auth/register and /auth/login shapes. */
export async function registerAndLogin(
  app: INestApplication,
  overrides: Partial<TestUser> = {},
): Promise<{ accessToken: string; refreshToken: string; user: TestUser }> {
  const user = buildUser(overrides);

  // POST /auth/register -> { id, email, createdAt } -- no password/hash, per your real DTO.
  await request(app.getHttpServer()).post('/auth/register').send(user).expect(201);

  // POST /auth/login -> { accessToken, refreshToken }
  const loginRes = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email: user.email, password: user.password })
    .expect(200);

  return {
    accessToken: loginRes.body.accessToken,
    refreshToken: loginRes.body.refreshToken,
    user,
  };
}

/**
 * Convenience: a logged-in user who already owns one project.
 * POST /projects only requires being authenticated -- the creator automatically
 * becomes that project's `owner` in project_members (per your Assignment 2 PR).
 */
export async function registerLoginAndCreateProject(
  app: INestApplication,
  projectName = 'Test Project',
): Promise<{ accessToken: string; projectId: string }> {
  const { accessToken } = await registerAndLogin(app);

  const projectRes = await request(app.getHttpServer())
    .post('/projects')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ name: projectName })
    .expect(201);

  return { accessToken, projectId: projectRes.body.id };
}
