---
name: review-code
description: Use when the user asks for a full, iterative code review of the entire project — Core, every subsystem, and every framework. Trigger on phrases like "review the code", "audit the project", "review everything", "loop until clean", "full project review". The skill exercises every route, every query, every frontend page, and every event handler through the project's testing skills (test-db-queries, test-routes, test-frontend, test-events, check-library-updates), fixes failures, and restarts the loop until no errors remain. This skill has nothing to do with uncommitted code, etc., and nothing to do with Git. It's for reviewing the project's codebase.
---

# Review Code

Iterative, whole-project review loop that **exercises the code** — every route,
every query, every frontend page, every event handler — through the project's
testing skills. Reading files and checking the checklist is secondary; running
the code and fixing failures is the primary activity. Repeats until a full pass
produces zero failures.

## When to use

- The user asks for a complete review, audit, or sanity check of the project.
- The user wants the project hardened until it is clean ("loop until no errors",
  "keep reviewing until everything passes").
- After a large refactor or merge, before shipping.

The user may optionally specify a review target — one or more of: `core`, a
specific subsystem (by slug), a specific subframework (by name), or any
combination thereof. The user can also specify only components or parts of
these. When specified, the loop is restricted to those layers only. When no
target is given, the full project is reviewed.

Do NOT use this skill for a scoped review of a single file — use the normal
review flow and the `isolation-guard` skill to confirm the target layer.

## Preconditions

1. Run `skills/isolation-guard/SKILL.md` first only if the user's request is
   ambiguous about scope. A full-project review is unambiguous, so this skill
   proceeds directly.
2. Read the root `AGENTS.md` and `docs/agent-checklist.md` in full before the
   first pass. They are the source of truth for every rule verified here.
3. Verify `database.json` has `"test": true`. Every test skill requires it. If
   it's missing or `false`, set it to `true` before proceeding and warn the user
   to revert it after the review.

## The loop

Repeat until a full pass completes with zero findings:

### Phase 1 — Enumerate scope

List every runnable artifact in the project:

- **Routes:** every `app/api/**/route.ts` file.
- **Queries:** every exported function in every `server/db/queries/**/*.ts`, In
  addition to queries scattered throughout the files - find all `db.query`
  calls.
- **Event handlers:** every registered handler name (core + systems +
  frameworks).
- **Frontend pages:** every `app/**/page.tsx` file.
- **Subsystems:** every `[slug]` folder under `systems/`.
- **Frameworks:** every `<name>` folder under `frameworks/`.

### Phase 2 — Run every test skill against every artifact

This is the core of the review. For each category below, run the corresponding
test skill against **every** artifact in that category. Record every failure,
unexpected status, broken render, unhandled event, etc as a finding.

#### 2a. Database — run `skills/test-db-queries/SKILL.md`

For every query function in `server/db/queries/` and queries scattered
throughout the files - find all `db.query` calls (core + systems + frameworks):

1. Read the query file to understand what the function does and what parameters
   it expects.
2. Construct a valid SurrealQL test call for each query.
3. Run the query and verify:
   - The result shape matches what the route handler expects.
   - FETCH directives resolve record links correctly.
   - Cursor pagination works (returns `nextCursor`/`prevCursor` when
     applicable).
   - No SurrealDB errors in the output.

#### 2b. Routes — run `skills/test-routes/SKILL.md`

For every route in `app/api/` (core + systems + frameworks):

1. Start the dev server: `tsx skills/test-routes/run.ts server start`
2. Login as superuser: `tsx skills/test-routes/run.ts login`
3. For each HTTP method the route supports (GET, POST, PUT, DELETE):
   - Construct a request with valid parameters.
   - Run the request:
     `tsx skills/test-routes/run.ts <METHOD> <PATH>
     --as-superuser --body '<json>'`
   - Verify the response: `success: true`, expected data shape, no errors.
   - Also test **error paths**: missing required fields, invalid data,
     unauthorized access (no token), wrong roles.
4. Record every non-200 response that isn't an expected validation rejection as
   a finding.

#### 2c. Events — run `skills/test-events/SKILL.md`

For every registered event handler (core + systems + frameworks):

1. Trigger the action that publishes the event (via `test-routes` or
   `test-db-queries`).
2. Wait for the delivery:
   `tsx skills/test-events/run.ts wait --handler
   <name> --timeout 30000`
3. Verify the delivery reached `status: "done"` (not `"dead"`).
4. For dead deliveries, read `lastError` and record as a finding.
5. For communication events, also verify the `verification_request` row was
   created and carries the expected `actionKey`.

#### 2d. Frontend — run `skills/test-frontend/SKILL.md`

For every page in `app/` (auth pages, core admin, app panel, public pages):

1. Start the frontend driver: `tsx skills/test-frontend/run.ts start`
2. For pages requiring auth, run `tsx skills/test-frontend/run.ts login` first.
3. Navigate to the page: `tsx skills/test-frontend/run.ts goto <path>`
4. Verify the page renders without errors:
   - `tsx skills/test-frontend/run.ts console --tail 50` — check for `pageerror`
     entries.
   - `tsx skills/test-frontend/run.ts screenshot <page>.png` — visual check.
   - `tsx skills/test-frontend/run.ts exists 'main'` — content area rendered.
5. Record any page that fails to render, throws console errors, or shows a
   Next.js error overlay as a finding.

### Phase 3 — Checklist sweep

While the test results are the primary source of findings, also walk the
checklist in `docs/agent-checklist.md` to catch rule violations that don't
surface as runtime failures (e.g. missing i18n keys, wrong file locations,
missing `assertServerOnly` calls). For each violation found, record it as a
finding with file path, line number, and the violated rule.

### Phase 4 — Fix findings

Apply the minimal change that resolves each finding without introducing new
abstractions or drifting from the AGENTS.md rules. Keep fixes scoped — a bug fix
does not need surrounding cleanup.

After fixing, **re-run the specific test skill that caught the finding** to
confirm the fix works. Do not assume a fix is correct without exercising it.

### Phase 5 — Restart

Go back to Phase 1 and run the full sweep again. Stop only when a complete pass
produces zero findings across Core, every subsystem, and every framework, with
every test skill passing.

## Rules for the review itself

- **Do not skip running the test skills.** Every route, every query, every page,
  every event handler must be exercised. If a test skill cannot cover a snippet,
  state so explicitly in the finding log instead of marking it passed.
