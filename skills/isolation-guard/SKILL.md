---
name: isolation-guard
description: PRIORITY 1 — run BEFORE every other skill and before writing, editing, creating, deleting, or planning any code. The project has three strictly isolated layers (Core, subsystems, frameworks) and every change must belong to exactly one. Trigger this skill at the start of ANY development request (even single-word ones like "fix", "add", "refactor", "create a system") unless the prompt already names the target layer ("in Core", "in the grex-id subsystem", "in the agents framework", "create a new subsystem called X", "create a new framework called Y"). When the layer is unclear, this skill lists existing subsystems and frameworks dynamically, explains the three layers, and HARD-BLOCKS further work until the user answers. **Subsystem creation is mandatory-interactive: both a `slug` (the systemSlug — identifier used as folder name, `system.slug` column, URL segment, i18n namespace, `tenant.systemSlug`) AND a human-readable `--name "<Display Name>"` MUST be collected from the user; without either value the skill blocks (exit 2) and you MUST NOT proceed.** The skill scaffolds the folder structure mandated by the root AGENTS.md (subfolders, stub register.ts / AGENTS.md / i18n JSON files, `.gitkeep` in empty dirs) and wires the entry into systems/index.ts or frameworks/index.ts. On subsystem create it INSERTS a `system` row; on subsystem remove it DELETES it. Remove mode is dry-run by default; `--yes` is required for actual deletion.
---

# Isolation Guard

**Priority 1. Runs first. Blocks everything else.**

Every file in this project belongs to exactly one namespace — Core, one
subsystem, or one framework. Mixing them is forbidden by the root `AGENTS.md`
(§2.7). This skill is the gate that keeps that invariant alive.

## Decision tree

```
Did the user's prompt name the target layer?
├── YES ("in Core" / "in the <slug> subsystem" / "in the <name> framework")
│   └── Proceed with the work in that scope. Do NOT run this skill.
│
└── NO (anything ambiguous: "add X", "fix Y", "refactor Z", "make a new app")
    └── Run this skill in list-block mode:
        tsx skills/isolation-guard/run.ts
        Relay the printed message. Wait for the user's answer. Then:
        ├── "in Core"                                 → Proceed in Core.
        ├── "in the <slug> subsystem"                 → Proceed in that subsystem.
        ├── "in the <name> framework"                 → Proceed in that framework.
        ├── "create a new subsystem called <slug>"    → Ask for the display name,
        │                                               then scaffold (see below).
        └── "create a new framework called <name>"    → Scaffold (see below).
```

Skip this skill when:

1. The prompt already explicitly names the target layer (see the patterns above
   — case-insensitive).
2. The request is read-only — answering a question, summarizing code, running
   `skills/test-*`, or listing files. No files will be written.
3. The user has just answered the guard in the same conversation.

**When in doubt, run it.** A false positive costs one short answer; a false
negative writes code in the wrong namespace.

## Three modes

### 1. List-block — confirm the target layer

Run with no arguments:

```bash
tsx skills/isolation-guard/run.ts
```

The script scans `systems/*/` and `frameworks/*/` at runtime, prints the current
inventory plus the three-layer explanation, and exits with code `2` meaning
"blocked — awaiting user clarification".

After running it:

1. Relay the printed message to the user (verbatim or summarized, but keep the
   dynamic list of subsystems and frameworks intact).
2. **Stop.** Do not read files, plan, invoke another skill, or write code until
   the user answers.
3. Once answered, proceed in that scope. Do not re-run the guard in the same
   conversation.

### 2. Scaffold — create a new subsystem or framework

#### Subsystem

**Subsystem creation is mandatory-interactive.** Before running the command you
MUST collect TWO values from the user:

1. **slug** (positional argument after `--create-subsystem`) — the `systemSlug`.
   The same string is used as the folder name under every Core root
   (`systems/<slug>/`, `src/components/systems/<slug>/`,
   `app/api/systems/<slug>/`, `server/db/queries/systems/<slug>/`, etc.), as the
   `system.slug` column in the database, as the URL segment in
   `/api/systems/<slug>/…`, as the i18n namespace `systems.<slug>.*`, and as the
   `tenant.systemSlug` embedded in every JWT. Lowercase letters, digits,
   hyphens; must start with a letter. Chosen once — renaming later means a
   migration.
2. **name** (passed via `--name "<Display Name>"`) — the human-readable display
   name shown on the system card, in the ProfileMenu system selector, and on
   public pages. Free-form string with spaces allowed (e.g. `"Grex ID"`,
   `"My Cool App"`).

If you run the command without one of these, the skill prints an explainer and
exits with code `2`. **Do not invent, guess, or default a value** — ask the user
and re-run.

```bash
tsx skills/isolation-guard/run.ts --create-subsystem <slug> --name "<Display Name>"

# Example
tsx skills/isolation-guard/run.ts --create-subsystem grex-id --name "Grex ID"
```

What the command does (in order):

1. Validates the slug (`^[a-z][a-z0-9-]*$`).
2. Refuses if `"test": true` is not set in `database.json` (exit `2`).
3. Refuses if `systems/<slug>/` already exists or a `system` row with that slug
   already exists in the DB (exit `1`).
4. Writes `systems/<slug>/register.ts` (i18n-pre-wired stub) and
   `systems/<slug>/AGENTS.md` (inheriting stub, §26.2).
5. Writes empty `src/i18n/{en,pt-BR}/systems/<slug>.json` placeholders.
6. Creates every scoped subfolder mandated by AGENTS.md §6 and drops a
   `.gitkeep` into any that would otherwise be empty:
   `src/components/systems/<slug>/`, `server/db/migrations/systems/<slug>/`,
   `server/db/queries/systems/<slug>/`,
   `server/db/frontend-queries/systems/<slug>/`,
   `server/event-queue/handlers/systems/<slug>/`, `app/api/systems/<slug>/`,
   `public/systems/<slug>/`.
7. Adds an import and a call to `register<Slug>()` inside `registerAllSystems()`
   in `systems/index.ts`.
8. INSERTs a `system` row: `name = <display name>`, `slug = <slug>`,
   `logoUri = ""`, `termsOfService = NONE`.

#### Framework

Frameworks have no DB row, no display name, and no interactive prompt — just the
identifier:

```bash
tsx skills/isolation-guard/run.ts --create-framework <name>
```

What the command does:

1. Validates the name (same regex as slug).
2. Refuses if `frameworks/<name>/` already exists and is non-empty (exit `1`).
3. Writes `frameworks/<name>/AGENTS.md` (inheriting stub) and
   `frameworks/<name>/register.ts` (empty stub).
4. Writes empty `frameworks/<name>/src/i18n/{en,pt-BR}/<name>.json`
   placeholders.
5. Creates every scoped subfolder mandated by AGENTS.md §26.1 and drops a
   `.gitkeep` into any that would otherwise be empty:
   `frameworks/<name>/app/api/<name>/`,
   `frameworks/<name>/src/components/<name>/`,
   `frameworks/<name>/src/contracts/`,
   `frameworks/<name>/server/db/migrations/`,
   `frameworks/<name>/server/db/queries/`, `frameworks/<name>/server/db/seeds/`,
   `frameworks/<name>/server/utils/`, `frameworks/<name>/public/<name>/`.
6. Adds an import and a call to `register<Name>Framework()` inside
   `registerAllFrameworks()` in `frameworks/index.ts`.

### 3. Remove — delete an existing subsystem or framework

**Removal is destructive.** Default mode is dry-run; pass `--yes` to actually
delete.

```bash
# Dry run — prints the plan, touches nothing (exit 2).
tsx skills/isolation-guard/run.ts --remove-subsystem <slug>
tsx skills/isolation-guard/run.ts --remove-framework <name>

# Confirmed — deletes everything (exit 0).
tsx skills/isolation-guard/run.ts --remove-subsystem <slug> --yes
tsx skills/isolation-guard/run.ts --remove-framework <name> --yes
```

Subsystem removal (dry-run lists each item, `--yes` deletes):

- Every folder the scaffolder created (all eight scoped roots).
- The `src/i18n/{en,pt-BR}/systems/<slug>.json` files.
- The import and `register<Slug>();` call in `systems/index.ts`.
- The `system` row in the DB (`DELETE system WHERE slug = <slug>`). Requires
  `"test": true`. Silently skipped when no matching row exists.

Framework removal:

- `frameworks/<name>/` and everything inside it.
- The import and `register<Name>Framework();` call in `frameworks/index.ts`.

## Exit codes

| Code | Meaning                                                                                                                                             |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Scaffold or confirmed removal completed.                                                                                                            |
| `1`  | Validation error (missing/invalid identifier, target already exists, DB conflict, target to remove does not exist). Fix the input and re-run.       |
| `2`  | Blocking signal. List-block mode, missing required `--name`, missing `"test": true`, or a dry-run awaiting `--yes`. **Stop and relay the message.** |

## What the user must say (list-block mode replies)

One of these is enough:

| Target                  | Example user reply                                                |
| ----------------------- | ----------------------------------------------------------------- |
| Core                    | "in Core"                                                         |
| Existing subsystem      | "in the `grex-id` subsystem"                                      |
| Existing framework      | "in the `agents` framework"                                       |
| Brand-new subsystem     | "create a new subsystem called `my-slug`" (then ask for the name) |
| Brand-new framework     | "create a new framework called `my-name`"                         |
| Core first, then tenant | "Core change first, then apply in the `grex-id` subsystem"        |

Ambiguous answers ("the backend", "the API", "the app") cross layer boundaries —
run the skill again.

## Layer cheat-sheet (mirror of AGENTS.md §6 + §26)

- **Core** — platform foundation at the project root (`app/`, `src/`,
  `server/`). Knows nothing about specific subsystems or frameworks.
- **Subsystems** — runtime tenants. One `<slug>` folder per product under every
  relevant root. Consume from Core and declared frameworks; never extend Core,
  never reach into another subsystem.
- **Frameworks** — reusable, design-time extensions of Core under
  `frameworks/<name>/`. Consumed by zero or more subsystems; never import from
  Core internals, another framework, or any subsystem.

Layering is one-way: **Core ⇐ Frameworks ⇐ Subsystems**.

## Rules

- Never skip this skill because "the answer seems obvious". New subsystems and
  frameworks appear between conversations — always check live.
- Never hardcode the inventory in your answer. Use the output of `run.ts`, not
  training data.
- Never proceed after list-block mode without an explicit user answer. Silence
  is not consent.
- Never invoke another skill (`test-db-queries`, `test-routes`, `test-frontend`,
  `test-events`, `check-library-updates`) before this one when the triggers
  above apply.
- Runtime-agnostic: uses `node:*` built-ins only (`node:fs`, `node:path`,
  `node:process`) — same shape Deno accepts.
