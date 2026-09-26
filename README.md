# Week 10 — Assignment 2: How to wire this into your repo

## 1. Files
- `test/journey.e2e-spec.ts` — the full journey test (W1, W2, C1, C2)
- `test/jest-e2e.json` — coverage threshold config (C3)

Drop both into your `week-10` repo on your `week-10-assignment2` branch, next to
whatever `test/` setup you already have from Assignment 1.

## 2. Adapt to your real API (do this first — the test will fail otherwise)
Open `journey.e2e-spec.ts` and check every one of these against your actual
Week 9 Assignment 3 code:

- Route paths: `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`,
  `/projects`, `/projects/:id/tasks`, `/tasks/:id/comments`,
  `/projects/:id/members`
- Response field names: `accessToken` / `refreshToken` (some setups use
  `access_token` / `refresh_token`)
- The role name for a read-only collaborator (`'VIEWER'` here — use whatever
  your Week 9 roles/guards actually check)
- Table names in the `TRUNCATE` call — match your TypeORM entity table names
  exactly (check your migrations if unsure)
- If your app registers global pipes/filters/interceptors somewhere other than
  directly on `app` in `main.ts` (e.g. in `AppModule` via `APP_PIPE`), you may
  not need the explicit `app.useGlobalPipes(...)` call at all — remove the
  duplicate if so, since the point (C is testing the wrong application) is to
  mirror `main.ts` exactly, not to add extra config.

## 3. package.json script
```json
"scripts": {
  "test:e2e": "jest --config ./test/jest-e2e.json"
}
```
Run with a `.env.test` pointing at your **test** database (same one from
Assignment 1) — never your dev database, since this suite truncates tables.

## 4. C3 — prove the coverage gate actually gates
In your PR description, paste:
1. `npm run test:e2e` output showing coverage ≥ 70% and the command passing.
2. Temporarily delete/comment one service test, re-run, paste the failure
   showing the threshold check failing the command.
3. Restore the test, re-run, paste it passing again.

## 5. C4 — prove three tests can actually fail
Pick three assertions (e.g. one in this journey file, two of your services
tests from Assignment 1). For each, in your PR description:
- Name the exact line of production code you temporarily broke
  (e.g. "removed the `ForbiddenException` throw in `TasksService.create`
  for non-owner roles").
- Paste the test output going red.
- Confirm you reverted the change and the suite is green again.

This step is manual by design — it's proving the tests aren't theatre, so it
has to be evidence from a real run, not more code.

## 6. Acceptance checklist (from the program doc)
- [ ] Flow runs green from an empty database: register → login → project →
      task → comment → refresh → protected route
- [ ] Intermediate state asserted at each step, not just final status
- [ ] 403 (viewer write) and 401 (after logout) exercised inside this same
      flow file
- [ ] `coverageThreshold` ≥ 70% statements on services, enforced in config
- [ ] Three tests shown failing when their behaviour was broken (see §5)
- [ ] `npm run test:e2e` green, coverage at/above bar, PR open
