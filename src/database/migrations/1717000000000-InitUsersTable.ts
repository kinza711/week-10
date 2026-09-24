import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Baseline schema carried over from earlier weeks of the Task Management
 * domain. Week 9 does not redesign this table - it only adds to it
 * (see 1717000100000-AddAuthTables.ts). Kept here so this repository's
 * migration history is self-contained and runnable from a clean database.
 */
export class InitUsersTable1717000000000 implements MigrationInterface {
  name = 'InitUsersTable1717000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    `);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "email" character varying NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_users_email" UNIQUE ("email"),
        CONSTRAINT "PK_users_id" PRIMARY KEY ("id")
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "users";`);
  }
}
