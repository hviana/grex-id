---
name: review-code
description: Use when the user asks for a full, iterative code review of the entire project — Core, every subsystem, and every framework. Trigger on phrases like "review the code", "audit the project", "review everything", "loop until clean", "full project review". The skill reviews the whole codebase against the root `AGENTS.md` rules using the checklist in `docs/agent-checklist.md`, exercises database operations, endpoints, frontend files, and events via the project's testing skills, and restarts the loop until no errors remain.
---

# Review Code

Iterative, whole-project review loop. Reviews Core, every subsystem, and every
framework against the authoritative rules in the root `AGENTS.md` using the
checklist in `docs/agent-checklist.md`. Exercises each code snippet — database
operations, HTTP endpoints, frontend pages, and event-queue handlers — through
the project's dedicated testing skills. Repeats the full loop until a pass finds
zero errors.

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

## The loop

Repeat until a full pass completes with zero findings:

1. **Enumerate scope.**
   - Core: everything under the project root that is not in `systems/<slug>/`,
     `frameworks/<name>/`, or their sibling namespaced directories.
   - Subsystems: every `[slug]` folder under `systems/`,
     `src/components/systems/`, `server/db/migrations/systems/`,
     `server/db/queries/systems/`, `server/db/frontend-queries/systems/`,
     `server/event-queue/handlers/systems/`, `app/api/systems/`,
     `public/systems/`, `src/i18n/<locale>/systems/`.
   - Frameworks: every `<name>` folder under `frameworks/`.

2. **Checklist sweep.** For each layer, walk every item in
   `docs/agent-checklist.md` section by section. For each rule, locate the code
   that implements or violates it and verify the implementation against the
   referenced AGENTS.md section. Record every mismatch as a finding with file
   path, line number, and the violated rule.

3. **Exercise the code.** Do not trust reading alone — run the project's testing
   skills against the snippets you just reviewed:
   - Database operations (queries, migrations, seeds):
     `skills/test-db-queries/SKILL.md`.
   - HTTP endpoints (every route under `/api/**`):
     `skills/test-routes/SKILL.md`.
   - Frontend pages and UI flows: `skills/test-frontend/SKILL.md`.
   - Event-queue handlers and communications: `skills/test-events/SKILL.md`.
   - Dependency drift: `skills/check-library-updates/SKILL.md`. Treat any failed
     assertion, unexpected status, broken render, unhandled event, or stale
     dependency as a finding.

4. **Fix findings.** Apply the minimal change that resolves each finding without
   introducing new abstractions or drifting from the AGENTS.md rules. Keep fixes
   scoped — a bug fix does not need surrounding cleanup.

5. **Restart.** Go back to step 1 and run the full sweep again. Stop only when a
   complete pass produces zero findings across Core, every subsystem, and every
   framework, with every test skill passing.

## Rules for the review itself

- The root `AGENTS.md` is authoritative. A subsystem or framework `AGENTS.md`
  never overrides Core rules — it only adds (§26.2). Flag any contradiction as a
  finding.
- Layer isolation (§6, §26) is non-negotiable. Cross-namespace imports, shared
  files, or aliases between Core ↔ framework ↔ subsystem are findings.
- Every checklist item in `docs/agent-checklist.md` maps to an AGENTS.md
  section. When a rule does not apply to a given file, skip it deliberately —
  record the deliberate skip so the next pass does not re-flag it.
- Do not claim success on code that was not exercised. If a test skill cannot
  cover a snippet (e.g. UI you cannot drive in a browser), state so explicitly
  in the finding log instead of marking it passed.
- Only stop when a full pass is clean. A single remaining finding restarts the
  loop.
