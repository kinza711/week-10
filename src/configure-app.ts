import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/**
 * Everything here applies to both the real server (main.ts) and every
 * e2e test (test/*.e2e-spec.ts, via TestingModule.createNestApplication()).
 * Keeping it in one place means the tests prove the actual production
 * configuration, not a hand-copied approximation of it.
 */
export function configureApp(app: INestApplication): void {
  // Problem W2, tightened by Challenge X1. This is a pure JSON API - it
  // never serves HTML, so it never needs to load a script, style, font,
  // or frame from anywhere, including itself. default-src 'none' is
  // deliberately narrower than helmet's own default (which assumes a
  // page-serving app and allows 'self' for several directives). If a
  // docs route (e.g. Swagger UI) is ever mounted, that route's own
  // response needs a looser policy - Swagger UI ships inline scripts
  // and styles that 'none'/'self' alone won't allow - so it should
  // override this per-route rather than loosening it globally.
  app.use(
    helmet({
      contentSecurityPolicy: {
        // useDefaults: false, not the default merge - helmet's built-in
        // defaults assume a page-serving app (script-src 'self', a
        // style-src, etc.). This API serves JSON only and needs none of
        // that; merging with those defaults would leave directives this
        // API doesn't need active for no reason.
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
          objectSrc: ["'none'"],
        },
      },
    }),
  );

  // Problem W2. A single explicit origin, read from config rather than
  // typed into the source - never a wildcard, since a wildcard origin
  // together with credentials is something a browser refuses outright,
  // and it would defeat the point of restricting CORS at all.
  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  });

  // Problem C2. Strict everywhere: an unexpected field is rejected
  // (forbidNonWhitelisted), not silently stripped - a client sending a
  // field like role or isAdmin gets a loud 400, not a request that
  // quietly succeeded while ignoring what it sent.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Problem C1, extended by X2 (redaction) and X3 (env-dependent detail).
  app.useGlobalFilters(new AllExceptionsFilter());
}
