import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { createTestApp, truncateAllTables } from "./utils/test-app";
import { registerLoginAndCreateProject } from "./utils/auth.helper";

// A real, well-formed UUID (v4, correct variant digit) that will never exist
// in a freshly truncated table -- unlike "1111...1111", which fails @IsUUID()
// validation before your code even looks for the row.
const MISSING_UUID = "00000000-0000-4000-8000-000000000000";

describe("Tasks (integration)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    // W2 -- every test starts from a known (empty) state.
    await truncateAllTables(app);
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------
  // CORE -- C1: happy path through HTTP, create then read back
  // ---------------------------------------------------------------------
  it("C1: creates and reads back a task", async () => {
    const { accessToken, projectId } = await registerLoginAndCreateProject(app);

    // CreateTaskDto only has title / description / assigneeId -- status is
    // NOT settable on create, it defaults to 'todo' on the entity.
    const createRes = await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ title: "Write integration tests" })
      .expect(201);

    expect(createRes.body).toMatchObject({
      title: "Write integration tests",
      status: "todo",
    });

    const getRes = await request(app.getHttpServer())
      .get(`/tasks/${createRes.body.id}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    expect(getRes.body).toMatchObject({
      id: createRes.body.id,
      title: "Write integration tests",
      status: "todo",
    });
  });

  // ---------------------------------------------------------------------
  // CORE -- C2: 400 (bad body) and 401 (no token)
  // ---------------------------------------------------------------------
  it("C2: rejects an invalid body with 400 and a matching error shape", async () => {
    const { accessToken, projectId } = await registerLoginAndCreateProject(app);

    // title is required (@MinLength(1)) -- sending an empty title should fail validation.
    const res = await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ title: "" })
      .expect(400);

    expect(res.body).toHaveProperty("statusCode", 400);
    expect(res.body).toHaveProperty("message");
  });

  it("C2: rejects a write with no token with 401", async () => {
    const { projectId } = await registerLoginAndCreateProject(app);

    const res = await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks`)
      .send({ title: "No token task" })
      .expect(401);

    expect(res.body).toHaveProperty("statusCode", 401);
  });

  // ---------------------------------------------------------------------
  // CORE -- C3: 404 for a missing resource, on read/update/delete
  // ---------------------------------------------------------------------
  describe("C3: 404 on a well-formed but non-existent id", () => {
    it("GET returns 404", async () => {
      const { accessToken } = await registerLoginAndCreateProject(app);
      const res = await request(app.getHttpServer())
        .get(`/tasks/${MISSING_UUID}`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(404);
      expect(res.body).toHaveProperty("statusCode", 404);
    });

    it("PATCH returns 404", async () => {
      const { accessToken } = await registerLoginAndCreateProject(app);
      const res = await request(app.getHttpServer())
        .patch(`/tasks/${MISSING_UUID}`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ description: "updated" })
        .expect(404);
      expect(res.body).toHaveProperty("statusCode", 404);
    });

    it("DELETE returns 404", async () => {
      const { accessToken } = await registerLoginAndCreateProject(app);
      const res = await request(app.getHttpServer())
        .delete(`/tasks/${MISSING_UUID}`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(404);
      expect(res.body).toHaveProperty("statusCode", 404);
    });
  });

  // ---------------------------------------------------------------------
  // CORE -- C4: independence
  // ---------------------------------------------------------------------
  it("C4: a task created in one test is not visible to a fresh test", async () => {
    const { accessToken, projectId } = await registerLoginAndCreateProject(app);

    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body).toHaveLength(0);
  });

  // ---------------------------------------------------------------------
  // CHALLENGE -- X1: combinable filters
  // Status can't be set on create, so we PATCH one task to 'done' after
  // creating it, to get two different status values to filter between.
  // NOTE: confirm your UpdateTaskDto actually accepts a `status` field --
  // if the field name differs, adjust the .send() below to match.
  // ---------------------------------------------------------------------
  it("X1: filters by status AND projectId together", async () => {
    const { accessToken, projectId } = await registerLoginAndCreateProject(app);
    const { accessToken: otherToken, projectId: otherProjectId } =
      await registerLoginAndCreateProject(app, "Other Project");

    const matching = await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ title: "Matches both" })
      .expect(201);

    // Right status ('todo' by default), different project -- near-miss.
    await request(app.getHttpServer())
      .post(`/projects/${otherProjectId}/tasks`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ title: "Wrong project" })
      .expect(201);

    // Right project, wrong status -- create then PATCH to 'done'.
    const wrongStatusTask = await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ title: "Wrong status" })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/tasks/${wrongStatusTask.body.id}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "done" })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get(`/projects/${projectId}/tasks?status=todo`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(matching.body.id);
  });

  // ---------------------------------------------------------------------
  // CHALLENGE -- X2: an unknown field is rejected
  // ---------------------------------------------------------------------
  it("X2: rejects a request carrying an undeclared field", async () => {
    const { accessToken, projectId } = await registerLoginAndCreateProject(app);

    const res = await request(app.getHttpServer())
      .post(`/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${accessToken}`)
      // "role" is not a declared field on CreateTaskDto at all (unlike createdBy,
      // which IS declared and accepted-but-ignored) -- this must be forbidden.
      .send({ title: "Sneaky field", role: "admin" })
      .expect(400);

    expect(res.body).toHaveProperty("statusCode", 400);

    const listRes = await request(app.getHttpServer())
      .get(`/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    expect(listRes.body).toHaveLength(0);
  });
});
