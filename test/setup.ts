/**
 * Runs ONCE, before any test file, before any test framework code exists yet.
 * Two jobs: (1) refuse to run against anything that isn't obviously a test DB,
 * (2) run migrations so the test DB has the current schema.
 *
 * This is plain Node/TS run directly by Jest's "globalSetup" — no @nestjs/testing
 * here, just your TypeORM DataSource.
 */
import { config } from 'dotenv';
import { DataSource } from 'typeorm';

module.exports = async () => {
  config({ path: '.env.test' });

  const dbName = process.env.DB_NAME ?? '';

  // X3 — hard guard: never let this suite point at a non-test database.
  if (!dbName.toLowerCase().includes('test')) {
    throw new Error(
      `Refusing to run the test suite: DB_NAME is "${dbName}", which does not ` +
        `look like a test database (expected the name to contain "test"). ` +
        `Point .env.test at a throwaway database before running npm run test:e2e.`,
    );
  }

  // Matches src/config/typeorm.datasource.ts's entity/migration globs.
  // Reuse that file's DataSource directly instead if it's easy to import here —
  // it guarantees the schema never drifts from what migration:run actually applies.
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: dbName,
    entities: ['src/**/*.entity.ts'],
    migrations: ['src/database/migrations/*.ts'],
    synchronize: false,
  });

  await dataSource.initialize();
  await dataSource.runMigrations();
  await dataSource.destroy();

  console.log(`[globalSetup] Migrations applied to test database "${dbName}".`);
};
