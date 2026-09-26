import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Assignment 1 / Problem W1.
 *
 * Adds exactly the two things authentication needs on top of the existing
 * domain:
 *  - users.password_hash: an argon2/bcrypt hash, never plaintext.
 *  - refresh_tokens: token_hash only - the raw refresh token is handed to
 *    the client once and is never persisted, since the database is one of
 *    the places an attacker may already be reading.
 *
 * synchronize stays false for the whole project - this migration is the
 * only way this schema change happens.
 */
export class AddAuthTables1717000100000 implements MigrationInterface {
  name = 'AddAuthTables1717000100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN "password_hash" character varying NOT NULL DEFAULT '';
    `);
    // Drop the temporary default now that every existing row has a value;
    // every future insert must supply a real hash explicitly.
    await queryRunner.query(`
      ALTER TABLE "users" ALTER COLUMN "password_hash" DROP DEFAULT;
    `);

    await queryRunner.query(`
      CREATE TABLE "refresh_tokens" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "token_hash" character varying NOT NULL,
        "family_id" uuid NOT NULL,
        "expires_at" TIMESTAMPTZ NOT NULL,
        "revoked_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_refresh_tokens_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_refresh_tokens_user_id" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_refresh_tokens_user_id" ON "refresh_tokens" ("user_id");
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_refresh_tokens_token_hash" ON "refresh_tokens" ("token_hash");
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_refresh_tokens_family_id" ON "refresh_tokens" ("family_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "refresh_tokens";`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "password_hash";`);
  }
}
