import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { DataSource } from 'typeorm';
import { configureApp } from '../src/configure-app';
import { ProjectRole } from '../src/common/enums/project-role.enum';

/**
 * WEEK 10 — ASSIGNMENT 2
 * One realistic end-to-end journey through the whole product:
 * register -> login -> create project -> create task -> comment
 * -> refresh token -> continue on a protected route
 * -> denied branches: 403 (viewer write), 401 (after logout)
 *
 * Bootstraps the app exactly the way rbac.e2e-spec.ts does (via
 * configureApp), rather than reconstructing global pipes by hand, so
 * this test exercises the real app, not a stand-in for it.
 *
 * There is no HTTP endpoint for adding a project member (confirmed from
 * rbac.e2e-spec.ts's own comment: "no membership management endpoint
 * exists yet"). Membership is seeded the same way that spec does it —
 * directly through the ProjectMember repository.
 */

describe('End-to-end user journey (e2e)', () => {
  jest.setTimeout(30000);

  let app: INestApplication;
  let dataSource: DataSource;

  // Shared journey state — ids are UUID strings in this schema.
  let accessToken: string;
  let refreshToken: string;
  let userId: string;
  let projectId: string;
  let taskId: string;
  let commentId: string;

  // Second user used for the 403 (viewer write) branch
  let viewerAccessToken: string;
  let viewerEmail: string;

  const owner = {
    email: `owner+${Date.now()}@example.com`,
    password: 'StrongPass!123',
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();

    // Mirror main.ts exactly — same helper rbac.e2e-spec.ts and
    // auth.e2e-spec.ts use — instead of hand-rolling pipes here.
    configureApp(app);

    await app.init();

    dataSource = app.get(DataSource);

    // Start from a known, empty state. CASCADE also clears
    // project_members and refresh_tokens via FK.
    await dataSource.query(
      `TRUNCATE TABLE "comments", "tasks", "projects", "users" RESTART IDENTITY CASCADE;`,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------
  // W1 + W2: register -> login -> project -> task -> comment,
  // asserting intermediate state at each step, not just final status.
  // ---------------------------------------------------------------------

  it('registers a new user', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send(owner)
      .expect(201);

    expect(res.body).toHaveProperty('id');
    expect(res.body.email).toBe(owner.email);
    userId = res.body.id;
  });

  it('logs in and receives an access token and a refresh token', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: owner.email, password: owner.password })
      .expect(200);

    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  it('creates a project as the logged-in user', async () => {
    // CreateProjectDto only has `name` (+ ignored legacy ownerId) — no
    // `description` field exists, so it's left out.
    const res = await request(app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Journey Project' })
      .expect(201);

    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toBe('Journey Project');
    // Intermediate-state assertion: the project actually belongs to this user.
    expect(res.body.ownerId ?? res.body.owner?.id).toBe(userId);
    projectId = res.body.id;
  });

  it('creates a task inside that project', async () => {
    // CreateTaskDto has title/description/assigneeId (+ ignored legacy
    // createdBy) — no `status` field exists, so it's left out.
    const res = await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: 'Write journey test' })
      .expect(201);

    expect(res.body).toHaveProperty('id');
    // Intermediate-state assertion: the task is wired to the right project.
    expect(res.body.projectId ?? res.body.project?.id).toBe(projectId);
    taskId = res.body.id;

    // Read it back through the project to confirm it's really attached
    // there, not just returned correctly by the create endpoint.
    const readBack = await request(app.getHttpServer())
      .get(`/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const ids = readBack.body.map((t: any) => t.id);
    expect(ids).toContain(taskId);
  });

  it('adds a comment on that task', async () => {
    const res = await request(app.getHttpServer())
      .post(`/tasks/${taskId}/comments`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ content: 'First comment on the journey task' })
      .expect(201);

    expect(res.body).toHaveProperty('id');
    // Intermediate-state assertion: the comment belongs to this task.
    expect(res.body.taskId ?? res.body.task?.id).toBe(taskId);
    commentId = res.body.id;
  });

  it('deletes a comment, then a repeat delete on the same id returns 404', async () => {
    // Throwaway comment, separate from `commentId`, so the final
    // chain-check later still finds the original comment intact.
    const created = await request(app.getHttpServer())
      .post(`/tasks/${taskId}/comments`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ content: 'Comment created only to be deleted' })
      .expect(201);
    const throwawayId = created.body.id;

    await request(app.getHttpServer())
      .delete(`/comments/${throwawayId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);

    // Now gone — exercises CommentsService.findByIdOrThrow's
    // NotFoundException branch.
    const res = await request(app.getHttpServer())
      .delete(`/comments/${throwawayId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);

    expect(res.body).toHaveProperty('message');
  });

  // ---------------------------------------------------------------------
  // C1: refresh the token part-way through, then keep using the new one.
  // ---------------------------------------------------------------------

  it('refreshes the access token and continues the journey with the new one', async () => {
    // Access token iat is second-precision; wait so refresh produces a
    // genuinely different token instead of an identical one issued in
    // the same second.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(200);

    expect(res.body).toHaveProperty('accessToken');
    const newAccessToken = res.body.accessToken;
    expect(newAccessToken).not.toBe(accessToken);
    accessToken = newAccessToken;

    // Prove the NEW token actually works on a protected route.
    const protectedRes = await request(app.getHttpServer())
      .get(`/projects/${projectId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(protectedRes.body.id).toBe(projectId);
  });

  // ---------------------------------------------------------------------
  // C2: denied branches inside the same flow — 403 for a viewer's write,
  // 401 after logout.
  // ---------------------------------------------------------------------

  it('adds a second user as a viewer and gets 403 when the viewer tries to write', async () => {
    viewerEmail = `viewer+${Date.now()}@example.com`;

    // Register + log in the viewer.
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: viewerEmail, password: owner.password })
      .expect(201);

    const viewerLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: viewerEmail, password: owner.password })
      .expect(200);

    viewerAccessToken = viewerLogin.body.accessToken;

    // No HTTP endpoint exists for adding a project member (per
    // rbac.e2e-spec.ts). Seed the membership directly, the same way
    // that spec does.
    const viewerUser = await dataSource
      .getRepository('User')
      .findOne({ where: { email: viewerEmail } });
    if (!viewerUser) {
      throw new Error('journey test setup: expected viewer user to exist');
    }
    await dataSource.getRepository('ProjectMember').save({
      userId: viewerUser.id,
      projectId,
      role: ProjectRole.VIEWER,
    });

    // Viewer attempts a write -> must be refused.
    const res = await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks`)
      .set('Authorization', `Bearer ${viewerAccessToken}`)
      .send({ title: 'Should not be allowed' })
      .expect(403);

    expect(res.body).toHaveProperty('message');
  });

  it('logs out and gets 401 reusing the refresh token afterward', async () => {
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken })
      .expect(204);

    // The now-invalidated refresh token must be rejected.
    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(401);

    expect(res.body).toHaveProperty('message');
  });

  // ---------------------------------------------------------------------
  // Sanity: the whole journey's data is actually consistent end to end.
  // ---------------------------------------------------------------------

  it('confirms the full chain: project -> task -> comment', async () => {
    // Re-login as owner since the previous token was logged out.
    const relogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: owner.email, password: owner.password })
      .expect(200);

    const freshToken = relogin.body.accessToken;

    const res = await request(app.getHttpServer())
      .get(`/tasks/${taskId}/comments`)
      .set('Authorization', `Bearer ${freshToken}`)
      .expect(200);

    const ids = res.body.map((c: any) => c.id);
    expect(ids).toContain(commentId);
  });
});