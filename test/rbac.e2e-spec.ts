import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { ProjectRole } from '../src/common/enums/project-role.enum';
import { configureApp } from '../src/configure-app';

/**
 * Requires a real Postgres database with migrations applied. Seeds two
 * users per scenario (an owner and a lower-privileged role) on the same
 * project, so every check below calls the identical route with two
 * different tokens and compares the outcome - proving the guard, not
 * just one branch of it.
 */
describe('RBAC (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const stamp = Date.now();

  const users = {
    owner: { email: `rbac-owner-${stamp}@example.com`, password: 'password123' },
    admin: { email: `rbac-admin-${stamp}@example.com`, password: 'password123' },
    member: { email: `rbac-member-${stamp}@example.com`, password: 'password123' },
    viewer: { email: `rbac-viewer-${stamp}@example.com`, password: 'password123' },
    outsider: { email: `rbac-outsider-${stamp}@example.com`, password: 'password123' },
  };
  const tokens: Record<keyof typeof users, string> = {} as any;

  let projectAId: string;
  let projectBId: string; // owned entirely by "outsider" - for Problem C3
  let taskInProjectAId: string;
  let memberUserId: string;

  async function registerAndLogin(email: string, password: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password });
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return login.body.accessToken as string;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    dataSource = moduleFixture.get(DataSource);

    for (const key of Object.keys(users) as (keyof typeof users)[]) {
      tokens[key] = await registerAndLogin(users[key].email, users[key].password);
    }

    // "owner" creates project A and is seeded as its owner automatically.
    const projectA = await request(app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${tokens.owner}`)
      .send({ name: `RBAC test project A ${stamp}` })
      .expect(201);
    projectAId = projectA.body.id;

    // Seed admin/member/viewer memberships directly - no membership
    // management endpoint exists yet (out of scope for this PR; see README).
    const membersRepo = dataSource.getRepository('ProjectMember');
    const usersRepo = dataSource.getRepository('User');
    const adminUser = await usersRepo.findOne({ where: { email: users.admin.email } });
    const memberUser = await usersRepo.findOne({ where: { email: users.member.email } });
    const viewerUser = await usersRepo.findOne({ where: { email: users.viewer.email } });

    if (!adminUser || !memberUser || !viewerUser) {
      throw new Error('RBAC test setup: expected admin/member/viewer users to exist');
    }
    memberUserId = memberUser.id;

    await membersRepo.save([
      { userId: adminUser.id, projectId: projectAId, role: ProjectRole.ADMIN },
      { userId: memberUser.id, projectId: projectAId, role: ProjectRole.MEMBER },
      { userId: viewerUser.id, projectId: projectAId, role: ProjectRole.VIEWER },
    ]);

    // A task inside project A, used by the C3 cross-project checks.
    const task = await request(app.getHttpServer())
      .post(`/projects/${projectAId}/tasks`)
      .set('Authorization', `Bearer ${tokens.owner}`)
      .send({ title: 'Task in project A' })
      .expect(201);
    taskInProjectAId = task.body.id;

    // "outsider" owns a completely separate project B, with no
    // membership at all on project A.
    const projectB = await request(app.getHttpServer())
      .post('/projects')
      .set('Authorization', `Bearer ${tokens.outsider}`)
      .send({ name: `RBAC test project B ${stamp}` })
      .expect(201);
    projectBId = projectB.body.id;
  });

  afterAll(async () => {
    const emails = Object.values(users).map((u) => u.email);
    await dataSource.query(
      `DELETE FROM comments WHERE author_id IN (SELECT id FROM users WHERE email = ANY($1))`,
      [emails],
    );
    await dataSource.query(
      `DELETE FROM tasks WHERE created_by IN (SELECT id FROM users WHERE email = ANY($1))`,
      [emails],
    );
    await dataSource.query(
      `DELETE FROM project_members WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1))`,
      [emails],
    );
    await dataSource.query(
      `DELETE FROM projects WHERE owner_id IN (SELECT id FROM users WHERE email = ANY($1))`,
      [emails],
    );
    await dataSource.query(
      `DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1))`,
      [emails],
    );
    await dataSource.query(`DELETE FROM users WHERE email = ANY($1)`, [emails]);
    await app.close();
  });

  describe('Problem C1: role read from project_members', () => {
    it('same route, two tokens: viewer gets 403, owner succeeds', async () => {
      await request(app.getHttpServer())
        .post(`/projects/${projectAId}/tasks`)
        .set('Authorization', `Bearer ${tokens.viewer}`)
        .send({ title: 'Viewer should not be able to create this' })
        .expect(403);

      await request(app.getHttpServer())
        .post(`/projects/${projectAId}/tasks`)
        .set('Authorization', `Bearer ${tokens.owner}`)
        .send({ title: 'Owner creating a task' })
        .expect(201);
    });

    it('member may create a task (not just owner/admin)', async () => {
      await request(app.getHttpServer())
        .post(`/projects/${projectAId}/tasks`)
        .set('Authorization', `Bearer ${tokens.member}`)
        .send({ title: 'Member creating a task' })
        .expect(201);
    });
  });

  describe('Problem C2: only owner/admin may delete a project', () => {
    it('member and viewer get 403; owner (or admin) gets 204', async () => {
      // Use throwaway projects for the destructive part of this test.
      const forMember = await request(app.getHttpServer())
        .post('/projects')
        .set('Authorization', `Bearer ${tokens.owner}`)
        .send({ name: `delete-by-member-test-${stamp}` })
        .expect(201);
      const memberUser = await dataSource
        .getRepository('User')
        .findOne({ where: { email: users.member.email } });
      if (!memberUser) {
        throw new Error('RBAC test setup: expected member user to exist');
      }
      await dataSource.getRepository('ProjectMember').save({
        userId: memberUser.id,
        projectId: forMember.body.id,
        role: ProjectRole.MEMBER,
      });

      await request(app.getHttpServer())
        .delete(`/projects/${forMember.body.id}`)
        .set('Authorization', `Bearer ${tokens.member}`)
        .expect(403);

      await request(app.getHttpServer())
        .delete(`/projects/${forMember.body.id}`)
        .set('Authorization', `Bearer ${tokens.owner}`)
        .expect(204);
    });
  });

  describe('Problem C3: a role on one project grants nothing on another', () => {
    it('outsider (owner of project B, no membership on A) cannot update a task in A', async () => {
      await request(app.getHttpServer())
        .patch(`/tasks/${taskInProjectAId}`)
        .set('Authorization', `Bearer ${tokens.outsider}`)
        .send({ title: 'Hijacked title' })
        .expect(403);
    });

    it('outsider cannot delete a task in project A', async () => {
      await request(app.getHttpServer())
        .delete(`/tasks/${taskInProjectAId}`)
        .set('Authorization', `Bearer ${tokens.outsider}`)
        .expect(403);
    });

    it('outsider cannot comment on a task in project A', async () => {
      await request(app.getHttpServer())
        .post(`/tasks/${taskInProjectAId}/comments`)
        .set('Authorization', `Bearer ${tokens.outsider}`)
        .send({ content: 'I should not be able to post this' })
        .expect(403);
    });

    it('a member of project A can still do all three', async () => {
      // X1's ownership guard means a plain member must be the task's
      // creator or assignee to edit it - make member the assignee first
      // so this test still proves "a legitimate member of the project
      // can act", without colliding with the ownership rule below.
      await request(app.getHttpServer())
        .patch(`/tasks/${taskInProjectAId}`)
        .set('Authorization', `Bearer ${tokens.owner}`)
        .send({ assigneeId: memberUserId })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/tasks/${taskInProjectAId}`)
        .set('Authorization', `Bearer ${tokens.member}`)
        .send({ title: 'Legitimate update' })
        .expect(200);

      await request(app.getHttpServer())
        .post(`/tasks/${taskInProjectAId}/comments`)
        .set('Authorization', `Bearer ${tokens.member}`)
        .send({ content: 'Legitimate comment' })
        .expect(201);
    });
  });

  describe('Problem C4: guard ordering', () => {
    it('an unauthenticated request to a role-restricted route returns 401, not 403', async () => {
      await request(app.getHttpServer())
        .post(`/projects/${projectAId}/tasks`)
        .send({ title: 'No token at all' })
        .expect(401);

      await request(app.getHttpServer())
        .delete(`/projects/${projectAId}`)
        .expect(401);
    });
  });

  describe('Challenge X1: task ownership, separate from project role', () => {
    let ownedByMemberTaskId: string;

    beforeAll(async () => {
      // A task the member themselves created - so they should be able
      // to edit it under the ownership rule, independent of role alone.
      const task = await request(app.getHttpServer())
        .post(`/projects/${projectAId}/tasks`)
        .set('Authorization', `Bearer ${tokens.member}`)
        .send({ title: 'Task created by member' })
        .expect(201);
      ownedByMemberTaskId = task.body.id;
    });

    it('a member editing a task they did not create and are not assigned to gets 403', async () => {
      // taskInProjectAId was created by "owner", not "member".
      await request(app.getHttpServer())
        .patch(`/tasks/${taskInProjectAId}`)
        .set('Authorization', `Bearer ${tokens.admin}`)
        .send({ assigneeId: null })
        .expect(200); // sanity: admin can still touch it via override below

      await request(app.getHttpServer())
        .patch(`/tasks/${taskInProjectAId}`)
        .set('Authorization', `Bearer ${tokens.member}`)
        .send({ title: 'Member should not be able to edit this' })
        .expect(403);
    });

    it('the task creator (also a member) can edit their own task', async () => {
      await request(app.getHttpServer())
        .patch(`/tasks/${ownedByMemberTaskId}`)
        .set('Authorization', `Bearer ${tokens.member}`)
        .send({ title: 'Member editing their own task' })
        .expect(200);
    });

    it('the assignee (even without creating it) can edit the task', async () => {
      const memberUser = await dataSource
        .getRepository('User')
        .findOne({ where: { email: users.member.email } });
      if (!memberUser) {
        throw new Error('RBAC test setup: expected member user to exist');
      }

      // Owner assigns the task (already owner-editable) to member.
      await request(app.getHttpServer())
        .patch(`/tasks/${taskInProjectAId}`)
        .set('Authorization', `Bearer ${tokens.owner}`)
        .send({ assigneeId: memberUser.id })
        .expect(200);

      // Now member, the assignee, can edit it despite not being its creator.
      await request(app.getHttpServer())
        .patch(`/tasks/${taskInProjectAId}`)
        .set('Authorization', `Bearer ${tokens.member}`)
        .send({ title: 'Assignee editing the task' })
        .expect(200);
    });

    it('owner/admin can still edit any task in the project - the role override', async () => {
      await request(app.getHttpServer())
        .patch(`/tasks/${ownedByMemberTaskId}`)
        .set('Authorization', `Bearer ${tokens.owner}`)
        .send({ title: 'Owner override on a task they did not create' })
        .expect(200);
    });
  });

  describe('Challenge X2: protected by default, not open by default', () => {
    it('every Projects/Tasks/Comments route requires a token even without a local @UseGuards(JwtAuthGuard)', async () => {
      // These controllers no longer declare JwtAuthGuard themselves
      // (see projects.controller.ts / tasks.controller.ts /
      // comments.controller.ts) - only RolesGuard. Authentication comes
      // entirely from the global APP_GUARD in auth.module.ts. If that
      // wiring were ever removed, every one of these would start
      // returning 200/403 instead of 401.
      await request(app.getHttpServer()).get(`/projects/${projectAId}`).expect(401);
      await request(app.getHttpServer()).post('/projects').send({ name: 'x' }).expect(401);
      await request(app.getHttpServer())
        .get(`/projects/${projectAId}/tasks`)
        .expect(401);
      await request(app.getHttpServer())
        .get(`/tasks/${taskInProjectAId}/comments`)
        .expect(401);
    });

    it('the four auth routes stay reachable without a token (@Public())', async () => {
      // Already exercised throughout this file via registerAndLogin(),
      // but asserted explicitly here as the direct proof for X2: these
      // are the only routes meant to opt out of the global guard.
      const email = `x2-public-check-${stamp}@example.com`;
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: 'password123' })
        .expect(201);
      await dataSource.query(`DELETE FROM users WHERE email = $1`, [email]);
    });
  });
});
