import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';

// Import your real root module — this is the whole point: same wiring as production.
import { AppModule } from '../../src/app.module';

// If you have a global exception filter (e.g. HttpExceptionFilter from Week 9),
// import and apply it below the same way main.ts does.
// import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();

  // MUST match main.ts exactly, or you're testing a different app than production.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // app.useGlobalFilters(new HttpExceptionFilter());

  await app.init();
  return app;
}

/**
 * Truncates every table except migration bookkeeping tables, in one statement,
 * with identity restarted so ids are predictable between tests.
 * Call this in afterEach — never in afterAll, or state leaks between test files.
 */
export async function truncateAllTables(app: INestApplication): Promise<void> {
  const dataSource = app.get(DataSource);
  const tables = dataSource.entityMetadatas
    .map((entity) => `"${entity.tableName}"`)
    .join(', ');

  if (!tables) return;

  await dataSource.query(
    `TRUNCATE ${tables} RESTART IDENTITY CASCADE;`,
  );
}
