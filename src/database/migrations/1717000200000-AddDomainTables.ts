import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Prerequisite for Assignment 2, not itself a graded RBAC problem.
 *
 * The Task Management domain (projects, project_members, tasks, comments)
 * is fixed for the whole program and would normally already exist from
 * earlier weeks. This repository starts from Week 9 only, so this
 * migration establishes that baseline domain before the RBAC problems
 * (W1-X3) add guards on top of it.
 */
export class AddDomainTables1717000200000 implements MigrationInterface {
  name = 'AddDomainTables1717000200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "project_role_enum" AS ENUM ('owner', 'admin', 'member', 'viewer');
    `);
    await queryRunner.query(`
      CREATE TYPE "task_status_enum" AS ENUM ('todo', 'in_progress', 'done');
    `);

    await queryRunner.query(`
      CREATE TABLE "projects" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" character varying NOT NULL,
        "owner_id" uuid NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_projects_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_projects_owner_id" FOREIGN KEY ("owner_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      );
    `);

    // Composite key (user_id, project_id) - the single source of truth
    // for every permission decision. A role on one project grants
    // nothing on another, because there is no global row to fall back to.
    await queryRunner.query(`
      CREATE TABLE "project_members" (
        "user_id" uuid NOT NULL,
        "project_id" uuid NOT NULL,
        "role" "project_role_enum" NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_project_members" PRIMARY KEY ("user_id", "project_id"),
        CONSTRAINT "FK_project_members_user_id" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_project_members_project_id" FOREIGN KEY ("project_id")
          REFERENCES "projects"("id") ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "tasks" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "title" character varying NOT NULL,
        "description" text,
        "status" "task_status_enum" NOT NULL DEFAULT 'todo',
        "created_by" uuid NOT NULL,
        "assignee_id" uuid,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tasks_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_tasks_project_id" FOREIGN KEY ("project_id")
          REFERENCES "projects"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_tasks_created_by" FOREIGN KEY ("created_by")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_tasks_assignee_id" FOREIGN KEY ("assignee_id")
          REFERENCES "users"("id") ON DELETE SET NULL
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "comments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "task_id" uuid NOT NULL,
        "author_id" uuid NOT NULL,
        "content" text NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_comments_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_comments_task_id" FOREIGN KEY ("task_id")
          REFERENCES "tasks"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_comments_author_id" FOREIGN KEY ("author_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`CREATE INDEX "IDX_project_members_project_id" ON "project_members" ("project_id");`);
    await queryRunner.query(`CREATE INDEX "IDX_tasks_project_id" ON "tasks" ("project_id");`);
    await queryRunner.query(`CREATE INDEX "IDX_comments_task_id" ON "comments" ("task_id");`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "comments";`);
    await queryRunner.query(`DROP TABLE "tasks";`);
    await queryRunner.query(`DROP TABLE "project_members";`);
    await queryRunner.query(`DROP TABLE "projects";`);
    await queryRunner.query(`DROP TYPE "task_status_enum";`);
    await queryRunner.query(`DROP TYPE "project_role_enum";`);
  }
}
