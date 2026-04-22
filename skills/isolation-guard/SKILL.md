---
name: isolation-guard
description: PRIORITY 1 — run BEFORE every other skill and before writing, editing, creating, deleting, or planning any code, file, migration, query, route, component, handler, template, seed, test, or doc. The project has three strictly isolated layers (Core, subsystems, frameworks) and every change must belong to exactly one. Trigger this skill at the very start of ANY development request (even single-word ones like "fix", "add", "refactor", "implement", "create a system", "add a framework") unless the user's prompt already explicitly names the target layer ("in Core", "in the grex-id subsystem", "in the agents framework", "create a new subsystem called X", "create a new framework called Y"). When the layer is not explicit, this skill lists the existing frameworks and subsystems dynamically, explains the difference, and HARD-BLOCKS further work until the user answers. When the user confirms a new subsystem or framework should be created, this same skill also scaffolds the mandatory folder structure from the root AGENTS.md (all required subfolders, stub register.ts / AGENTS.md / i18n JSON files) and drops `.gitkeep` into every directory that would otherwise be empty.
---

# Isolation Guard

**Priority 1. Runs first. Blocks everything else.**

Nothing in this project is layer-agnostic. Every file belongs to exactly one of
three namespaces (Core, one subsystem, or one framework) and mixing them is
forbidden by the root `AGENTS.md` (§6, §26). This skill is the gate that keeps
that invariant alive: before you touch any file, you confirm which layer the
work belongs to.

## When to invoke

Invoke this skill at the VERY START of the conversation, before any other skill,
any Read/Edit/Write/Bash call, and any planning, when the user asks you to do
any of the following and has NOT already named the target layer:

- Write, edit, create, delete, rename, or refactor code / files.
- Add a new feature, route, component, query, migration, seed, handler, job,
  template, contract, i18n key, or setting.
- Fix a bug, investigate a failure, or reproduce an issue that requires a code
  change.
- Create a new subsystem or a new framework (this skill also covers the "create
  a new one" branch — the user must still declare intent explicitly).
- Plan an implementation, write a design note, or break a task into steps.

Skip this skill ONLY when one of the following is true:

1. The user's prompt already explicitly names the target layer using one of
   these patterns (case-insensitive):
   - "in Core" / "for Core" / "at the Core" / "Core-level" / "the root AGENTS"
   - "in the `<slug>` subsystem" / "for subsystem `<slug>`" / "in
     `systems/<slug>/`"
   - "in the `<name>` framework" / "for framework `<name>`" / "in
     `frameworks/<name>/`"
   - "create a new subsystem called `<slug>`" / "add a subsystem `<slug>`"
   - "create a new framework called `<name>`" / "add a framework `<name>`"
2. The request is read-only (answering a question, summarizing code, running a
   test with `skills/test-*`, listing files). No files will be created or
   edited.
3. The user has JUST answered this skill in the same conversation — don't loop.

When in doubt, invoke it. A false positive costs one short answer; a false
negative lets you write code in the wrong namespace.

## Usage

The skill has two modes — a default "list + block" mode, and a scaffold mode for
creating the mandatory folder structure of a new subsystem or framework.

### 1. Default mode — list and block

Run with no arguments:

```bash
tsx skills/isolation-guard/run.ts
```

The script scans `frameworks/*/` and `systems/*/` at runtime (never a hardcoded
list), prints the current inventory, explains the three layers, and exits with
code `2` to signal "blocked — awaiting user clarification".

When the command finishes:

1. Show the printed message to the user verbatim — or summarize it, but keep the
   list of existing subsystems and frameworks intact.
2. **Stop.** Do not read files, do not plan, do not call another skill, do not
   propose code. Wait for the user to reply with the target layer.
3. Once the user answers ("do this in Core", "add it to the grex-id subsystem",
   "create a new framework called foo", etc.), continue with the original
   request under that scope. Do not re-run the guard in the same conversation.

### 2. Scaffold mode — create a new subsystem or framework

When the user confirms they want a new subsystem or framework, run the skill
with the appropriate flag **before** writing any other code. The scaffolder
creates every folder mandated by the root `AGENTS.md` (§6 for subsystems, §26.1
for frameworks), drops a `.gitkeep` into any directory that would otherwise be
empty, writes stub `register.ts` / `AGENTS.md` / empty i18n JSON files, and
wires the new entry into the matching aggregator (`systems/index.ts` or
`frameworks/index.ts`).

```bash
# New subsystem (lowercase slug, hyphens allowed, must start with a letter)
tsx skills/isolation-guard/run.ts --create-subsystem <slug>

# New framework (same identifier rules)
tsx skills/isolation-guard/run.ts --create-framework <name>
```

What gets created for a subsystem `<slug>`:

- `systems/<slug>/register.ts` — stub with i18n registration pre-wired.
- `systems/<slug>/AGENTS.md` — inheriting-root stub (§26.2).
- `src/i18n/{en,pt-BR}/systems/<slug>.json` — empty `{}` placeholders.
- `.gitkeep` inside every empty directory: `src/components/systems/<slug>/`,
  `server/db/migrations/systems/<slug>/`, `server/db/queries/systems/<slug>/`,
  `server/db/frontend-queries/systems/<slug>/`,
  `server/event-queue/handlers/systems/<slug>/`, `app/api/systems/<slug>/`,
  `public/systems/<slug>/`.
- `systems/index.ts` gets a new import and a call to `register()`.

What gets created for a framework `<name>`:

- `frameworks/<name>/AGENTS.md` — inheriting-root stub (§26.2).
- `frameworks/<name>/register.ts` — empty stub (§26.4).
- `frameworks/<name>/src/i18n/{en,pt-BR}/<name>.json` — empty `{}` placeholders.
- `.gitkeep` inside every empty directory: `frameworks/<name>/app/api/<name>/`,
  `frameworks/<name>/src/components/<name>/`,
  `frameworks/<name>/src/contracts/`, `frameworks/<name>/server/db/migrations/`,
  `frameworks/<name>/server/db/queries/`, `frameworks/<name>/server/db/seeds/`,
  `frameworks/<name>/server/utils/`, `frameworks/<name>/public/<name>/`.
- `frameworks/index.ts` gets a new import and a call to `register()`.

Safety:

- The scaffolder refuses if the target directory already exists (subsystem) or
  already exists and is non-empty (framework). It never overwrites files.
- Identifier validation: lowercase letters, digits, hyphens; must start with a
  letter. Anything else exits with a clear error.
- After scaffolding, proceed with the actual feature work under the new
  namespace — fill in the register stub, add migrations, queries, routes,
  components, etc., following the root `AGENTS.md`.

## What the user must say

One of these is enough:

| Target                      | Example user reply                                                |
| --------------------------- | ----------------------------------------------------------------- |
| Core (the platform itself)  | "in Core"                                                         |
| Existing subsystem          | "in the `grex-id` subsystem"                                      |
| Existing framework          | "in the `agents` framework"                                       |
| Brand-new subsystem         | "create a new subsystem called `my-slug`"                         |
| Brand-new framework         | "create a new framework called `my-name`"                         |
| Both (Core change + tenant) | "Core change needed first, then apply in the `grex-id` subsystem" |

If the user answers ambiguously ("the backend", "the API", "the app"), run the
skill again — those labels cross layer boundaries.

## Layer cheat-sheet (mirror of AGENTS.md §6 + §26)

- **Core** — the platform foundation. Lives at the project root (`app/`, `src/`,
  `server/`). Knows nothing about specific subsystems or frameworks.
- **Subsystems** — runtime tenants. One `[slug]` folder per product under every
  relevant root (`app/api/systems/<slug>/`, `src/components/systems/<slug>/`,
  `server/db/queries/systems/<slug>/`, `src/i18n/<locale>/systems/<slug>.json`,
  `systems/<slug>/register.ts`, …). Consume from Core and from declared
  frameworks; never extend Core, never reach into another subsystem.
- **Frameworks** — reusable, design-time extensions of Core, each under
  `frameworks/<name>/` with its own `AGENTS.md`, routes at `/api/<name>/…`,
  components under `frameworks/<name>/src/components/<name>/`, migrations /
  queries / utilities under `frameworks/<name>/server/…`, and a
  `frameworks/<name>/register.ts`. Consumed by zero or more subsystems; never
  import from Core internals, another framework, or any subsystem.

Layering is one-way: **Core ⇐ Frameworks ⇐ Subsystems**.

## Rules

- Never skip this skill because "the answer seems obvious". The project has been
  burned by Core files created inside framework folders and vice-versa.
- Never hardcode the inventory in your answer. Always use the run-time listing
  from `run.ts` — new subsystems and frameworks appear / disappear between
  conversations.
- Never proceed after running the skill without the user's explicit answer.
  Silence is not consent; an empty reply is not consent.
- Never invoke any other skill (`test-db-queries`, `test-routes`,
  `test-frontend`, `test-events`, `check-library-updates`) before this one when
  the triggers above apply.
- Uses Node built-ins via `node:*` specifiers (`node:fs`, `node:path`,
  `node:process`) so the script stays runtime-agnostic — same shape Deno
  accepts.
