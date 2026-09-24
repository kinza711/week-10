# Week 10 — Assignment 1: Integration Tests with Supertest

## Prerequisites (do these BEFORE writing any test)

1. **Packages** — you already have most of these from Weeks 8–9. Confirm/install:
   ```bash
   npm install --save-dev supertest @types/supertest jest ts-jest @types/jest
   npm install --save-dev cross-env
   ```
   (`cross-env` lets you set `NODE_ENV=test` the same way on Mac/Linux/Windows.)

2. **A second Postgres database** — literally just a new empty database, e.g. `taskmanager_test`.
   ```sql
   CREATE DATABASE taskmanager_test;
   ```
   Do NOT reuse your dev database. The whole point this week is a database the suite is
   allowed to destroy.

3. **A `.env.test` file** at your project root (copy `.env.test.example` from this bundle,
   fill in your real Postgres user/password, keep the database name as `taskmanager_test`
   or whatever you created).

4. **TypeORM CLI must be able to run migrations against `.env.test`.** If your
   `ormconfig`/`data-source.ts` currently reads `.env` only, you need it to read whichever
   env file matches `NODE_ENV`. See the note inside `test/setup.ts` below — it calls your
   migration runner programmatically, so as long as your `DataSource` picks up
   `process.env.NODE_ENV === 'test'` correctly, this works without extra CLI config.

5. **Your actual routes** (pulled from your real `week-9` repo, PR #1 and PR #2):
   - `POST /auth/register` → `{ email, password }` returns `{ id, email, createdAt }`
   - `POST /auth/login` → `{ email, password }` returns `{ accessToken, refreshToken }`
   - `POST /projects` (auth) → `{ name }` — creator becomes `owner`
   - `GET/PATCH/DELETE /projects/:id`
   - `POST /projects/:projectId/tasks` (owner/admin/member — viewer gets 403)
   - `GET /projects/:projectId/tasks`
   - `GET/PATCH/DELETE /tasks/:id`
   - `POST/GET /tasks/:taskId/comments`, `DELETE /comments/:id`

   Note: your env var is `DB_NAME`, not `DB_DATABASE` — already fixed in the files below.
   I could not confirm the exact required field on `CreateTaskDto` (assumed `title`) or
   whether `GET /projects/:projectId/tasks` supports a `?status=` query param — check
   `src/tasks/dto/create-task.dto.ts` and `tasks.controller.ts` and adjust the two spots
   flagged with `NOTE:` comments in `tasks.e2e-spec.ts` if needed.

## How this fits together

- `test/setup.ts` runs ONCE before the whole suite: it points TypeORM at the test
  database, runs migrations, and — this is important — refuses to run at all if the
  database name doesn't contain `test`. That's your safety net against ever truncating
  your real data by accident.
- `test/utils/test-app.ts` builds the Nest app in tests EXACTLY the way `main.ts` builds
  it in production (same `ValidationPipe`, same global filters). This is the #1 mistake
  called out in the grading notes — a test app without the real pipes passes requests the
  real API would reject.
- `test/utils/auth.helper.ts` is a small factory: register a user, log in, hand back a
  token. Every test calls this instead of repeating the same three requests.
- `test/tasks.e2e-spec.ts` is the actual graded suite: happy path (C1), 400/401 (C2), 404
  (C3), independence (C4), plus the two Challenge problems (X1, X2) as a bonus.

## Running it

Add to `package.json`:
```json
"scripts": {
  "test:e2e": "cross-env NODE_ENV=test jest --config ./test/jest-e2e.json --runInBand"
}
```
`--runInBand` matters here: it runs tests in one process, not in parallel workers, which
keeps "truncate between tests" simple and avoids one worker truncating rows another worker
is mid-assertion on.

```bash
npm run test:e2e
```

For the Warm-up W1 check ("dev database untouched, test database has migrated tables"):
run it, then open your dev DB and confirm nothing changed, then open `taskmanager_test`
and confirm the tables exist.

For the C4 check ("passes in isolation, passes shuffled"):
```bash
npx jest --config ./test/jest-e2e.json -t "creates and reads back a task"
npx jest --config ./test/jest-e2e.json --config ./test/jest-e2e.json --randomize
```
(Paste both outputs into your PR, as the assignment asks.)

## What to actually type yourself

Copy the structure and logic in by hand rather than pasting the whole file — especially
`auth.helper.ts` and the first integration test in `tasks.e2e-spec.ts`. Those two are what
the grader is really testing your understanding of; the config files (`jest-e2e.json`,
`setup.ts`) are plumbing you can paste once and move on.

When you're done, say the word and I'll quiz you on this (test isolation, why HTTP-level
beats mocked-repo, what `afterEach` truncation actually buys you) before you move to
Assignment 2.
