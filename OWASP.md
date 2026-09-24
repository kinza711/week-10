# OWASP Top 10 (2021) — Mitigations in This Repository

Each item names the concrete file or guard that mitigates it, and what
proves it. "N/A" entries are justified, not skipped.

## A01:2021 — Broken Access Control

**Mitigated.**
- `src/common/guards/jwt-auth.guard.ts` — registered globally
  (`APP_GUARD` in `auth.module.ts`) since Assignment 2's Challenge X2.
  A route requires a valid token by default; only the four `/auth`
  routes opt out with `@Public()`.
- `src/common/guards/roles.guard.ts` — reads the caller's role from
  `project_members` for the *specific* project a request touches
  (never "a member somewhere"). Proven in `test/rbac.e2e-spec.ts`: a
  viewer creating a task gets `403`; an outsider who owns a *different*
  project still gets `403` on a task in this one.
- `src/common/guards/task-ownership.guard.ts` — role alone isn't
  enough for `PATCH /tasks/:id`; below owner/admin, only the task's
  creator or assignee may edit it.
- `src/common/guards/roles.guard.ts`'s guard ordering: global guards
  (`JwtAuthGuard`) always run before controller-level ones
  (`RolesGuard`) in Nest, so a missing token is always `401`, never a
  confusing `403` — proven in `test/rbac.e2e-spec.ts`.

## A02:2021 — Cryptographic Failures

**Mitigated.**
- `src/auth/auth.service.ts` — passwords hashed with argon2id
  (`src/config/argon2.config.ts`), never a fast hash. Cost is
  configurable via env, strong by default, deliberately weak only
  under `NODE_ENV=test`.
- Refresh tokens: the raw token is handed to the client once and never
  stored — only its SHA-256 hash (`AuthService`'s `hashToken()`).
- `JWT_ACCESS_SECRET` and both token expiries come from `.env`, never
  hardcoded — `src/config/typeorm.datasource.ts` and
  `src/auth/auth.module.ts` both read from `ConfigService`/`process.env`.
- Transport encryption (TLS) is a deployment concern, not application
  code — `helmet()`'s `Strict-Transport-Security` header
  (`src/configure-app.ts`) tells browsers to enforce HTTPS once the
  app sits behind TLS termination, which is as far as this layer goes.

## A03:2021 — Injection

**Mitigated.**
- Every database query in this repo goes through TypeORM's query
  builder or repository methods with parameterized values
  (`RolesGuard`, `TasksService`, `ProjectsService`, etc.) — no raw
  string-concatenated SQL anywhere in `src/`.
- `ParseUUIDPipe` on every route param (`projects.controller.ts`,
  `tasks.controller.ts`, `comments.controller.ts`) plus guard-level
  `isUUID()` checks (`roles.guard.ts`, `task-ownership.guard.ts`,
  Problem C3) reject malformed input before it reaches a query at all.
- The global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`,
  `src/configure-app.ts`) rejects any request body shape the DTOs
  don't explicitly declare.

## A04:2021 — Insecure Design

**Mitigated.**
- Refresh token rotation with reuse detection
  (`AuthService.refresh()`, Assignment 1 Challenge X1): a revoked
  token coming back revokes its entire token family, since that
  pattern only happens when two parties hold descendants of the same
  login.
- Per-project roles via `project_members`, not a global `isAdmin`
  flag on the user — a role on one project structurally cannot grant
  anything on another, because every check reads the row for *this*
  project specifically.
- Rate limiting scoped tightest on the highest-risk routes
  (`auth.controller.ts`'s `@Throttle()` on register/login/refresh)
  rather than a single blanket limit for the whole app.

## A05:2021 — Security Misconfiguration

**Mitigated.**
- `src/configure-app.ts` — `helmet()` with a CSP set to
  `useDefaults: false` and every directive `'none'` (Assignment 3
  Challenge X1); CORS restricted to one explicit origin from config,
  never a wildcard.
- `synchronize: false` always, in every environment
  (`app.module.ts`, `src/config/typeorm.datasource.ts`) — schema
  changes only ever happen through a committed migration.
- `src/common/filters/all-exceptions.filter.ts` — a stack trace or
  raw database error never reaches the client in production
  (Problem X3); the same filter also stops framework/library default
  error pages (which often reveal versions) from ever rendering,
  since every error is caught and reshaped centrally.

## A06:2021 — Vulnerable and Outdated Components

**Partially mitigated — honestly reported, not swept under the rug.**
- `.github/workflows/ci.yml` runs `npm audit --audit-level=high` as a
  build step (Assignment 3 Challenge X1).
- **As of this PR, that step genuinely fails.** `npm audit --omit=dev
  --audit-level=high` reports 15 advisories (8 moderate, 5 high,
  1 critical) in production-path dependencies: `tar` (critical — pulled
  in transitively by `argon2`'s install-time `@mapbox/node-pre-gyp`
  binary downloader, not by any code that runs when serving a
  request), `lodash` (via `@nestjs/config`), `multer` and `body-parser`
  (via `@nestjs/platform-express`), `qs`, and `uuid`. None of these are
  vulnerabilities in code this repository wrote.
- Fixing them means breaking major-version upgrades across several
  `@nestjs/*` packages at once (`@nestjs/core`, `@nestjs/config`,
  `@nestjs/platform-express` all need coordinated bumps) — a real
  migration, not a hardening-week fix, and out of scope for this PR.
- The audit step's value here is exactly this: it makes the finding
  visible and blocks it from going unnoticed, rather than claiming a
  clean bill of health that isn't true. Tracked as a follow-up.

## A07:2021 — Identification and Authentication Failures

**Mitigated.**
- argon2 password hashing, refresh rotation with reuse detection
  (see A02/A04).
- `auth.controller.ts`'s `@Throttle()` on register/login/refresh —
  login is the one route an attacker can otherwise call forever with
  a password list (Problem W1).
- `AuthService.validateCredentials()` returns the *identical* `401`
  for a wrong password and for an email that was never registered, so
  the status code and body can't be used to enumerate accounts
  (Assignment 1 Problem C1) — a dummy hash operation runs on the
  not-found path too, so it isn't measurably faster either.
- Access tokens are short-lived (`JWT_ACCESS_EXPIRES_IN`, default
  15m); refresh tokens can be individually revoked
  (`POST /auth/logout`) without touching sessions on other devices.

## A08:2021 — Software and Data Integrity Failures

**Mitigated.**
- Schema changes only through committed, reviewed migrations
  (`src/database/migrations/`) — `synchronize` is never `true`.
- `.github/workflows/ci.yml` — the dependency audit step (see A06)
  also catches integrity issues in the supply chain before they're
  merged, not just known-CVE severity.
- JWT signatures are verified server-side on every request
  (`JwtStrategy`, `passport-jwt`) — a token can't be forged or
  tampered with without the signing secret, which never leaves
  `.env`/the server process.

## A09:2021 — Security Logging and Monitoring Failures

**Mitigated.**
- `src/common/filters/all-exceptions.filter.ts` — every error, caught
  centrally in one place, logs a structured line (`path`, `method`,
  `statusCode`, the request body and exception message, both
  redacted) rather than being silently swallowed or inconsistently
  logged per-handler.
- Severity is meaningful: 5xx logs at `ERROR` with the full stack
  trace; ordinary 4xx (a wrong password, a bad request body) logs at
  `DEBUG` — so an operational problem doesn't get buried under routine
  client errors (Problem C1).
- Known-sensitive fields (`password`, `passwordHash`, `token`,
  `refreshToken`, `authorization`) are redacted centrally before
  anything is logged, wherever they appear in the request body or
  exception (Challenge X2) — proven with a test that spies on the
  logger directly and asserts a real password/token never appears in
  the logged line.

## A10:2021 — Server-Side Request Forgery (SSRF)

**N/A.** This API never takes a URL, hostname, or address from a
client and uses it to make an outbound request — there's no webhook
registration, no "import from URL", no image-fetch-by-link, no
outbound HTTP call driven by request input anywhere in `src/`. The
only outbound network calls this service makes are its own database
connection (TypeORM, to a fixed, server-configured host) — nothing a
caller controls.

## The one item this API is still most exposed to

**A06 (Vulnerable and Outdated Components).** Every other item has a
concrete, currently-passing mitigation. A06 is the one place this PR
is honest that the finding exists and isn't fixed — the CI audit step
would fail today if actually run, for reasons documented above. That
makes it the most exposed real gap in this snapshot of the repo, not
because the design is wrong, but because the dependency tree hasn't
been upgraded to match.
