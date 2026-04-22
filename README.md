# Overview

Serverless multi-tenant platform built on Next.js 16, SurrealDB 3, and
TailwindCSS 4. Runs on Node (via Next or Vinext) and on Deno.

---

## Setup

1. Install dependencies (Node):
   ```bash
   npm install
   ```

2. Copy the database config template and fill in your SurrealDB credentials:
   ```bash
   cp database.example.json database.json
   ```

3. Have a SurrealDB 3.0 instance reachable at the URL you configured.

---

## Database: migrations and seeds

Migrations live in `server/db/migrations/` (plus `systems/<slug>/` and
`frameworks/<name>/server/db/migrations/`). Seeds live in `server/db/seeds/`.
The runner scans all of them, sorts by numeric prefix globally, and applies only
what's pending. Seeds are idempotent.

### Node

```bash
# Migrations + seeds in one shot
npm run db:setup

# Or each step independently
npm run db:migrate
npm run db:seed
```

### Deno

```bash
deno run -A server/db/setup.ts
```

You can also invoke the runners directly:

```bash
deno run -A -e "import('./server/db/migrations/runner.ts').then(m => m.runMigrations())"
deno run -A -e "import('./server/db/seeds/runner.ts').then(m => m.runSeeds())"
```

---

## Running the app

### Next (Node)

```bash
npm run dev       # dev server on :3000
npm run build
npm run start
```

### Vinext (Node)

Vinext is the Vite + Nitro runtime target (see `vite.config.ts`).

```bash
npm run dev:vinext     # dev server on :3001
npm run build:vinext
npm run start:vinext
```

### Next (Deno)

```bash
deno run -A npm:next dev
deno run -A npm:next build
deno run -A npm:next start
```

### Vinext (Deno)

```bash
deno run -A npm:vite dev --port 3001
deno run -A npm:vite build
deno run -A npm:vinext start
```

---

## Developing in this project

This codebase is spec-first. The rules that govern every change live in
documentation files, not in tribal knowledge — read them before writing code.

### AGENTS.md

[AGENTS.md](AGENTS.md) is the single source of truth for the Core: runtime
invariants, tech stack, DB conventions, middleware pipeline, event queue,
communication, auth, billing, and extensibility. `CLAUDE.md` re-exports it so
Claude Code loads the same rules.

Every rule there is load-bearing. Do not skim — search the section that covers
what you're about to change.

### The three layers: Core, subsystems, frameworks

The codebase has three distinct layers. Keep them isolated — no layer reaches
into another's folder.

- **Core** is the platform foundation at the project root (`app/`, `src/`,
  `server/`). It knows nothing about specific products.
- **Subsystems** are runtime tenants — one `[slug]` per product. They live in
  `[slug]` subfolders under the relevant Core roots (`systems/<slug>/`,
  `src/components/systems/<slug>/`, `server/db/queries/systems/<slug>/`, etc.)
  and **consume** resources from Core and frameworks.
- **Frameworks** are reusable extensions of Core. Each framework lives in
  `frameworks/<name>/` as a self-contained module and can be consumed by many
  subsystems.

The direction of dependency is strict: Core ⇐ Frameworks ⇐ Subsystems.
Frameworks extend Core; subsystems consume both. A framework never imports from
a subsystem, and no subsystem reaches into another subsystem's folder.

### Nested AGENTS.md

Both frameworks and subsystems can ship their own nested `AGENTS.md`:

- Each framework under `frameworks/<name>/` **ships** its own `AGENTS.md`
  (required).
- Each subsystem under `systems/<slug>/` **may ship** its own `AGENTS.md`
  (optional, recommended once the subsystem has non-trivial contracts).

Both **inherit** the root `AGENTS.md` verbatim and list only what's specific to
their namespace. Neither ever overrides Core rules — only extends them.

When working inside a framework or subsystem, read the root `AGENTS.md` first,
then the nested one. A subsystem that consumes frameworks follows the root
`AGENTS.md` plus every relevant framework's `AGENTS.md` plus its own. Never mix
files across namespaces.

### docs/agent-checklist.md

Before marking any task done, run through
[docs/agent-checklist.md](docs/agent-checklist.md). It's a linked checklist that
maps every concern (auth, tenant context, caching, credits, files, templates,
i18n, security, …) back to the relevant AGENTS.md section. Skip items
deliberately, never by default.

### skills/

Repeatable operations have their own skill under `skills/<name>/SKILL.md`. Read
the `SKILL.md` before running anything. Current skills:

- `skills/isolation-guard/` — **PRIORITY 1, runs before every other skill.**
  Confirms which layer (Core, subsystem, or framework) a development request
  belongs to, lists the currently existing subsystems and frameworks
  dynamically, and blocks further work until the user declares the target layer
  explicitly. Also covers the "create a new subsystem / framework" branch.
- `skills/test-db-queries/` — run ad-hoc SurrealQL against the test DB.
- `skills/test-routes/` — exercise API routes end-to-end.
- `skills/test-frontend/` — drive the UI in a real browser via Playwright. Also
  handles absolute external URLs (OAuth consent pages, payment-provider
  redirects, third-party callback URLs).
- `skills/test-events/` — debug or verify **any** handler in the event queue
  (not just communications): wait on a `delivery`, inspect the payload
  (transactionId, subscriptionId, recipients, any custom field a subsystem or
  framework handler put there). For communication events specifically, also
  extracts the `verification_request` link and can click it via `test-frontend`.
  Works even without real provider credentials (email, SMS, payment gateway, …)
  — validation is done on the queue rows.
- `skills/check-library-updates/` — audit and apply dependency bumps.
- `skills/review-code/` — run a full, iterative review of Core, every subsystem,
  and every framework against `AGENTS.md` + `docs/agent-checklist.md`,
  exercising DB operations, endpoints, frontend pages, and events via the test-*
  skills, restarting until no findings remain.

Each skill enforces its own guardrails (e.g. `test-db-queries` refuses to run
unless `database.json` has `"test": true`).

### Typical workflow

1. Run `skills/isolation-guard/` **first** to pin down the target layer (Core, a
   subsystem, or a framework) unless the user already named it explicitly.
2. Read the AGENTS.md section(s) covering the area you're changing.
3. If a framework is involved, read its nested `AGENTS.md` too.
4. Implement the change, reusing shared components / queries / utilities
   (generic-first, see §3.1).
5. Verify with the matching skill (DB queries, routes, or browser).
6. Walk through [docs/agent-checklist.md](docs/agent-checklist.md) before
   calling the task done.
