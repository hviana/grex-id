import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { closeDb, getDb } from "../../server/db/connection.ts";
import dbConfig from "../../database.json" with { type: "json" };

/**
 * isolation-guard — PRIORITY 1 skill.
 *
 * Three modes:
 *
 *   1. No flags (default) — dynamically lists existing frameworks and
 *      subsystems, explains the three layers, and exits with code 2 so the
 *      caller knows work is blocked pending the user's declaration.
 *
 *   2. --create-subsystem <slug> --name "<Display Name>"
 *      OR --create-framework <name>
 *      Scaffolds the self-contained bundle structure mandated by the root
 *      AGENTS.md (§2.7, §11). Subsystem create also inserts a `system`
 *      row. Requires `"test": true` in database.json for subsystem
 *      mutations.
 *
 *   3. --remove-subsystem <slug>  OR  --remove-framework <name>
 *      Dry-run by default (exit 2). Pass --yes to actually delete. Removes
 *      the entire bundle directory, un-wires the entry from the matching
 *      index.ts, and (for subsystems) deletes the `system` row. Requires
 *      `"test": true` for subsystem mutations.
 *
 * Runtime-agnostic: only uses `node:*` built-ins.
 */

/* -------------------------------------------------------------------- */
/* Constants & shared helpers                                           */
/* -------------------------------------------------------------------- */

const CLI = "node --conditions=react-server skills/isolation-guard/run.ts";
const projectRoot = resolve(new URL(".", import.meta.url).pathname, "..", "..");

type Kind = "subsystem" | "framework";
type Mode =
  | "list"
  | "create-subsystem"
  | "create-framework"
  | "remove-subsystem"
  | "remove-framework";

interface Args {
  mode: Mode;
  target?: string;
  displayName?: string;
  confirmed: boolean;
}

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  const confirmed = args.includes("--yes") || args.includes("-y");

  let displayName: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--name" || args[i] === "-n") {
      displayName = args[i + 1];
      break;
    }
  }

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const next = args[i + 1];
    if (flag === "--create-subsystem" || flag === "-s") {
      return { mode: "create-subsystem", target: next, displayName, confirmed };
    }
    if (flag === "--create-framework" || flag === "-f") {
      return { mode: "create-framework", target: next, confirmed };
    }
    if (flag === "--remove-subsystem") {
      return { mode: "remove-subsystem", target: next, confirmed };
    }
    if (flag === "--remove-framework") {
      return { mode: "remove-framework", target: next, confirmed };
    }
  }
  return { mode: "list", confirmed };
}

function validateIdentifier(id: string | undefined, label: string): string {
  if (!id) {
    console.error(`[isolation-guard] Missing ${label} identifier.`);
    process.exit(1);
  }
  if (!/^[a-z][a-z0-9-]*$/.test(id)) {
    console.error(
      `[isolation-guard] Invalid ${label} "${id}". Use lowercase letters, digits, and hyphens only; must start with a letter.`,
    );
    process.exit(1);
  }
  return id;
}

function toCamel(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}

/**
 * Register-function alias used in the aggregator index.ts for a given kind
 * and identifier. Subsystems use `register<Camel>` so the alias matches the
 * slug; frameworks use `register<Camel>Framework` to make the layer
 * explicit (and so a subsystem and a framework with the same identifier
 * would not clash if both ever lived in the tree).
 */
function aliasFor(kind: Kind, camel: string): string {
  return kind === "subsystem"
    ? `register${camel}`
    : `register${camel}Framework`;
}

function frontendAliasFor(kind: Kind, camel: string): string {
  return kind === "subsystem"
    ? `register${camel}Frontend`
    : `register${camel}FrameworkFrontend`;
}

function ensureDir(abs: string): void {
  mkdirSync(abs, { recursive: true });
}

function writeIfAbsent(abs: string, contents: string): "created" | "skipped" {
  if (existsSync(abs)) return "skipped";
  ensureDir(dirname(abs));
  writeFileSync(abs, contents, "utf8");
  return "created";
}

function addGitkeepIfEmpty(dirAbs: string): "created" | "skipped" {
  ensureDir(dirAbs);
  if (readdirSync(dirAbs).length === 0) {
    writeFileSync(resolve(dirAbs, ".gitkeep"), "", "utf8");
    return "created";
  }
  return "skipped";
}

function reportAction(label: string, target: string, status: string): void {
  const rel = target.startsWith(projectRoot + "/")
    ? target.slice(projectRoot.length + 1)
    : target;
  console.log(`  [${status}] ${label.padEnd(12)} ${rel}`);
}

function listDirectChildren(dirAbs: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dirAbs);
  } catch {
    return [];
  }
  return entries
    .filter((name) => !name.startsWith("."))
    .filter((name) => {
      try {
        return statSync(resolve(dirAbs, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.localeCompare(b));
}

function assertTestMode(): void {
  if ((dbConfig as { test?: unknown }).test === true) return;
  console.error(
    [
      "[isolation-guard] REFUSING TO TOUCH THE DATABASE.",
      "",
      'database.json does not have `"test": true`.',
      "",
      "Creating or removing a subsystem writes / deletes a `system` row.",
      "This skill only mutates a database that has been explicitly marked",
      "as a test target. To proceed:",
      "",
      "  1. Confirm the database in database.json is a TEST database,",
      "     never production.",
      '  2. Set `"test": true` in database.json.',
      "  3. Re-run this command.",
      "",
      '  When you are done, flip it back to `"test": false`.',
    ].join("\n"),
  );
  process.exit(2);
}

/* -------------------------------------------------------------------- */
/* Shared help text                                                     */
/* -------------------------------------------------------------------- */

const USAGE_HELP = `\
Scaffold a new subsystem or framework:
  ${CLI} --create-subsystem <slug> --name "<Display Name>"
    (slug IS the systemSlug — same string used as the namespace folder
     systems/<slug>/, the system.slug DB column, the URL segment in
     /api/systems/<slug>/, the i18n namespace systems.<slug>.*, and the
     tenant.systemSlug in every JWT. --name is the human-readable
     display label.)
  ${CLI} --create-framework <name>

Completely remove an existing subsystem or framework (destructive):
  ${CLI} --remove-subsystem <slug>         # dry run, prints the plan
  ${CLI} --remove-subsystem <slug> --yes   # actually deletes
  ${CLI} --remove-framework <name>         # dry run, prints the plan
  ${CLI} --remove-framework <name> --yes   # actually deletes`;

/* -------------------------------------------------------------------- */
/* Mode 1 — list & block                                                */
/* -------------------------------------------------------------------- */

function runListMode(): never {
  const frameworks = listDirectChildren(resolve(projectRoot, "frameworks"));
  const subsystems = listDirectChildren(resolve(projectRoot, "systems"));

  const bullets = (items: string[]): string =>
    items.length === 0 ? "  (none)" : items.map((s) => `  - ${s}`).join("\n");

  const message = `\
[isolation-guard] BLOCKING — target layer not specified.

Every change in this project must belong to exactly ONE of three layers.
You must tell me which layer this work belongs to before I start.

The three layers:

  1. Core        — the platform foundation at the project root. Shared
                   rules, tables, routes, components, settings. Knows
                   nothing about any specific subsystem or framework.

  2. Subsystem   — a runtime tenant / product. Self-contained bundle under
                   systems/<slug>/ with src/ (components, contracts, hooks,
                   i18n, lib, providers), server/ (db, event-queue, jobs,
                   middleware, utils), and public/<slug>/. API routes at
                   /api/systems/<slug>/... (Core-level). Consumes Core and
                   any frameworks it declares. Never extends Core.

  3. Framework   — a reusable, design-time extension of Core. Self-contained
                   bundle under frameworks/<name>/ with the same internal
                   shape as a subsystem (src/, server/, public/<name>/).
                   API routes at /api/<name>/... (Core-level). Consumed by
                   zero or more subsystems. Never imports from Core
                   internals, other frameworks, or any subsystem.

  Layering is one-way:  Core  <=  Frameworks  <=  Subsystems

Currently existing subsystems (under systems/):
${bullets(subsystems)}

Currently existing frameworks (under frameworks/):
${bullets(frameworks)}

Please answer with ONE of:
  - "in Core"
  - "in the <slug> subsystem"             (pick from the list above)
  - "in the <name> framework"             (pick from the list above)
  - "create a new subsystem called <slug>"
  - "create a new framework called <name>"

${USAGE_HELP}

I will not read, write, or plan anything until you reply.`;

  console.log(message);
  process.exit(2);
}

/* -------------------------------------------------------------------- */
/* Mode 2 — scaffold                                                    */
/* -------------------------------------------------------------------- */

function printSystemSlugExplainer(slug: string | undefined): never {
  console.error(
    `\
[isolation-guard] MISSING REQUIRED SUBSYSTEM METADATA.

Creating a subsystem needs TWO values — BOTH are mandatory:

  1. slug       — the machine-readable identifier (the systemSlug).
                  Same string used as the namespace folder
                  systems/<slug>/, the system.slug column in the
                  database, the URL segment in /api/systems/<slug>/,
                  the i18n namespace systems.<slug>.*, and the
                  tenant.systemSlug carried in every JWT. Lowercase
                  letters, digits, hyphens; must start with a letter.
                  Chosen ONCE — renaming it later means a migration.

  2. name       — the human-readable display name shown on the system
                  card, in the ProfileMenu system selector, and on
                  public pages. Free-form string with spaces and
                  punctuation allowed (e.g. "Grex ID", "My Cool App").

Usage:

  ${CLI} --create-subsystem <slug> --name "<Display Name>"

Example:

  ${CLI} --create-subsystem grex-id --name "Grex ID"

${
      slug
        ? `Received slug: "${slug}" but --name was not provided.`
        : "Neither --create-subsystem <slug> nor --name was provided."
    }

Ask the user for BOTH values and re-run. Do not proceed without them.`,
  );
  process.exit(2);
}

function subsystemRegisterStub(slug: string, camel: string): string {
  return `import { registerSystemI18n } from "@/server/module-registry";

export function register(): void {
  // Event handlers — registerHandler("<event_name>", handlerFn);
  //   import { myHandler } from "./server/event-queue/handlers/my-handler";

  // Components — registerComponent("<componentName>", () => import("./src/components/Foo"));

  // Homepage — registerHomePage("${slug}", () => import("./src/components/HomePage"));

  // i18n
  registerSystemI18n("${slug}", "en", () => import("./src/i18n/en/${slug}.json"));
  registerSystemI18n("${slug}", "pt-BR", () => import("./src/i18n/pt-BR/${slug}.json"));

  // Jobs — registerJob("<name>", startFn);
  //   import { startMyJob } from "./server/jobs/my-job";

  // Lifecycle hooks — registerLifecycleHook("lead:verify", async (payload) => { ... });
}
`;
}

function subsystemAgentsStub(slug: string): string {
  return `# ${slug} — Subsystem AGENTS

This subsystem runs on top of the Core and consumes resources from it (and
from the frameworks listed below). It inherits every rule, convention,
structure, naming policy, and architectural decision from the root
\`AGENTS.md\`. This document lists only what is subsystem-specific.

## Slug

\`${slug}\`

## Structure

This subsystem is a self-contained bundle under \`systems/${slug}/\` with
\`src/\`, \`server/\`, and \`public/${slug}/\` subdirectories (root AGENTS.md
§2.7, §11). No system code lives outside this root.

## Consumed frameworks

<!-- List the frameworks this subsystem depends on, if any. -->

## Owned entities

<!-- List the tables, contracts, routes, components, resource keys, and
     i18n namespaces owned by this subsystem. -->

## API routes

\`/api/systems/${slug}/…\`

## i18n namespace

\`systems.${slug}.*\`
`;
}

function frameworkRegisterStub(name: string): string {
  return `// Framework register entry point (AGENTS.md §4.6).

export function register(): void {
  // Event handlers — registerHandler("<event_name>", handlerFn);
  //   import { myHandler } from "./server/event-queue/handlers/my-handler";
  // Communication channels — registerChannel("<channel>"); registerHandler("send_<channel>", fn);
  // Templates — registerTemplate("<channel>", "<path>", fn) or registerTemplateBuilder("<name>", fn).
  //   import { myTemplate } from "./server/utils/communication/templates/<channel>/my-template";
  // Lifecycle hooks — registerLifecycleHook("lead:delete", fn);
  // Jobs — registerJob("<name>", startFn);
  //   import { startMyJob } from "./server/jobs/my-job";
}
`;
}

function frameworkAgentsStub(name: string): string {
  return `# ${name} — Framework AGENTS

This framework extends the Core. It inherits every rule, convention,
structure, naming policy, and architectural decision from the root
\`AGENTS.md\`. This document lists only what is framework-specific.

## Name

\`${name}\`

## Structure

This framework is a self-contained bundle under \`frameworks/${name}/\` with
\`src/\`, \`server/\`, and \`public/${name}/\` subdirectories (root AGENTS.md
§2.7, §11). No framework code lives outside this root.

## Owned entities

<!-- List tables, contracts, routes, components, resource keys, and
     i18n namespaces owned by this framework. -->

## API routes

\`/api/${name}/…\`

## i18n namespace

\`frameworks.${name}.*\`

## New Core / FrontCore settings introduced (if any)

<!-- Additive only. Seed through this framework's own seed file. -->
`;
}

function subsystemFrontendStub(slug: string): string {
  return `import { registerComponent, registerHomePage } from "@/src/frontend-registry";

export function registerFrontend(): void {
  // Components — registerComponent("<componentName>", () => import("./components/YourPage"));
  // Homepage — registerHomePage("${slug}", () => import("./components/HomePage"));
}
`;
}

function frameworkFrontendStub(): string {
  return `import { registerComponent } from "@/src/frontend-registry";

export function registerFrontend(): void {
  // Components — registerComponent("<componentName>", () => import("./components/YourPage"));
}
`;
}

async function createSubsystem(slug: string, name: string): Promise<void> {
  validateIdentifier(slug, "subsystem slug");
  assertTestMode();

  const camel = toCamel(slug);
  console.log(
    `[isolation-guard] Scaffolding subsystem "${slug}" (display name: "${name}")...`,
  );
  console.log("");

  if (existsSync(resolve(projectRoot, "systems", slug))) {
    console.error(
      `[isolation-guard] systems/${slug}/ already exists. Aborting to avoid overwriting existing work.`,
    );
    process.exit(1);
  }

  const db = await getDb();
  try {
    // Pre-flight: refuse if a `system` row already owns this slug.
    const existing = await db.query<[{ id: unknown }[]]>(
      "SELECT id FROM system WHERE slug = $slug",
      { slug },
    );
    if ((existing[0]?.length ?? 0) > 0) {
      console.error(
        `[isolation-guard] A system row with slug "${slug}" already exists in the database. Aborting.`,
      );
      process.exit(1);
    }

    const sysRoot = resolve(projectRoot, "systems", slug);

    // 1. Files with content. Per AGENTS.md §2.7 / §11: the system is a
    //    self-contained bundle under systems/<slug>/.
    const files: { label: string; path: string; content: string }[] = [
      {
        label: "file",
        path: resolve(sysRoot, "register.ts"),
        content: subsystemRegisterStub(slug, camel),
      },
      {
        label: "file",
        path: resolve(sysRoot, "src", "frontend.ts"),
        content: subsystemFrontendStub(slug),
      },
      {
        label: "file",
        path: resolve(sysRoot, "AGENTS.md"),
        content: subsystemAgentsStub(slug),
      },
      {
        label: "i18n",
        path: resolve(sysRoot, "src", "i18n", "en", `${slug}.json`),
        content: "{}\n",
      },
      {
        label: "i18n",
        path: resolve(sysRoot, "src", "i18n", "pt-BR", `${slug}.json`),
        content: "{}\n",
      },
    ];
    for (const f of files) {
      reportAction(f.label, f.path, writeIfAbsent(f.path, f.content));
    }

    // 2. Scoped directories per AGENTS.md §2.7 — all under systems/<slug>/.
    const scopedDirs = [
      `systems/${slug}/src/components`,
      `systems/${slug}/src/contracts/high-level`,
      `systems/${slug}/src/hooks`,
      `systems/${slug}/src/lib`,
      `systems/${slug}/src/providers`,
      `systems/${slug}/server/db/migrations`,
      `systems/${slug}/server/db/queries`,
      `systems/${slug}/server/db/frontend-queries`,
      `systems/${slug}/server/db/seeds`,
      `systems/${slug}/server/event-queue/handlers`,
      `systems/${slug}/server/jobs`,
      `systems/${slug}/server/middleware`,
      `systems/${slug}/server/utils`,
      `systems/${slug}/public/${slug}`,
    ];
    for (const rel of scopedDirs) {
      const abs = resolve(projectRoot, rel);
      reportAction("gitkeep", `${abs}/.gitkeep`, addGitkeepIfEmpty(abs));
    }

    // 3. Wire into systems/index.ts (server-side).
    wireRegisterIntoIndex({
      indexFile: resolve(projectRoot, "systems", "index.ts"),
      kind: "subsystem",
      camel,
      importSpecifier: `./${slug}/register`,
      aggregatorFn: "registerAllSystems",
    });

    // 4. Wire into systems/frontend.ts (client-side).
    wireRegisterIntoIndex({
      indexFile: resolve(projectRoot, "systems", "frontend.ts"),
      kind: "subsystem",
      camel,
      importSpecifier: `./${slug}/src/frontend`,
      aggregatorFn: "registerAllSystemsFrontend",
      importedName: "registerFrontend",
    });

    // 5. INSERT the matching system row so every tenant-scoped route
    //    finds the subsystem from its first authenticated request.
    try {
      const inserted = await db.query<[{ id: unknown }[]]>(
        `CREATE system SET name = $name, slug = $slug, logoUri = "", termsOfService = NONE`,
        { name, slug },
      );
      const id = String(inserted[0]?.[0]?.id ?? "(unknown)");
      reportAction("db", `system (id=${id}, slug=${slug})`, "created");
    } catch (err) {
      console.error(
        `[isolation-guard] Failed to INSERT system row for slug "${slug}": ${
          (err as Error).message
        }`,
      );
      console.error(
        "File scaffold completed, but the DB row was NOT created. Re-run the skill or insert the row manually before proceeding.",
      );
    }
  } finally {
    await closeDb();
  }

  console.log("");
  console.log(`[isolation-guard] Subsystem "${slug}" scaffolded.`);
  console.log("Next steps:");
  console.log(
    `  - Fill in systems/${slug}/register.ts as resources are added.`,
  );
  console.log(
    `  - Update systems/${slug}/AGENTS.md with subsystem-specific rules.`,
  );
  console.log(
    `  - Place components under systems/${slug}/src/components/, queries under systems/${slug}/server/db/queries/, routes under app/api/systems/${slug}/, etc.`,
  );
}

function createFramework(name: string): void {
  validateIdentifier(name, "framework name");
  const camel = toCamel(name);

  console.log(`[isolation-guard] Scaffolding framework "${name}"...`);
  console.log("");

  const frameworkRoot = resolve(projectRoot, "frameworks", name);
  if (existsSync(frameworkRoot) && readdirSync(frameworkRoot).length > 0) {
    console.error(
      `[isolation-guard] frameworks/${name}/ already exists and is non-empty. Aborting to avoid overwriting existing work.`,
    );
    process.exit(1);
  }

  // 1. Files with content. Per AGENTS.md §2.7 / §11: the framework is a
  //    self-contained bundle under frameworks/<name>/.
  const files: { label: string; path: string; content: string }[] = [
    {
      label: "file",
      path: resolve(frameworkRoot, "AGENTS.md"),
      content: frameworkAgentsStub(name),
    },
    {
      label: "file",
      path: resolve(frameworkRoot, "register.ts"),
      content: frameworkRegisterStub(name),
    },
    {
      label: "file",
      path: resolve(frameworkRoot, "src", "frontend.ts"),
      content: frameworkFrontendStub(),
    },
    {
      label: "i18n",
      path: resolve(frameworkRoot, "src", "i18n", "en", `${name}.json`),
      content: "{}\n",
    },
    {
      label: "i18n",
      path: resolve(frameworkRoot, "src", "i18n", "pt-BR", `${name}.json`),
      content: "{}\n",
    },
  ];
  for (const f of files) {
    reportAction(f.label, f.path, writeIfAbsent(f.path, f.content));
  }

  // 2. Directories per AGENTS.md §2.7 — all under frameworks/<name>/.
  const scopedDirs = [
    `frameworks/${name}/src/components`,
    `frameworks/${name}/src/contracts/high-level`,
    `frameworks/${name}/src/hooks`,
    `frameworks/${name}/src/lib`,
    `frameworks/${name}/src/providers`,
    `frameworks/${name}/server/db/migrations`,
    `frameworks/${name}/server/db/queries`,
    `frameworks/${name}/server/db/frontend-queries`,
    `frameworks/${name}/server/db/seeds`,
    `frameworks/${name}/server/event-queue/handlers`,
    `frameworks/${name}/server/jobs`,
    `frameworks/${name}/server/middleware`,
    `frameworks/${name}/server/utils`,
    `frameworks/${name}/public/${name}`,
  ];
  for (const rel of scopedDirs) {
    const abs = resolve(projectRoot, rel);
    reportAction("gitkeep", `${abs}/.gitkeep`, addGitkeepIfEmpty(abs));
  }

  // 3. Wire into frameworks/index.ts (server-side).
  wireRegisterIntoIndex({
    indexFile: resolve(projectRoot, "frameworks", "index.ts"),
    kind: "framework",
    camel,
    importSpecifier: `./${name}/register`,
    aggregatorFn: "registerAllFrameworks",
  });

  // 4. Wire into frameworks/frontend.ts (client-side).
  wireRegisterIntoIndex({
    indexFile: resolve(projectRoot, "frameworks", "frontend.ts"),
    kind: "framework",
    camel,
    importSpecifier: `./${name}/src/frontend`,
    aggregatorFn: "registerAllFrameworksFrontend",
    importedName: "registerFrontend",
  });

  console.log("");
  console.log(`[isolation-guard] Framework "${name}" scaffolded.`);
  console.log("Next steps:");
  console.log(`  - Fill in frameworks/${name}/register.ts.`);
  console.log(
    `  - Update frameworks/${name}/AGENTS.md with framework-specific rules.`,
  );
  console.log(
    `  - Place components under frameworks/${name}/src/components/, queries under frameworks/${name}/server/db/queries/, routes under app/api/${name}/, etc.`,
  );
}

/* -------------------------------------------------------------------- */
/* Mode 3 — remove                                                      */
/* -------------------------------------------------------------------- */

function collectSubsystemTargets(slug: string): {
  dirs: string[];
  files: string[];
} {
  // With the self-contained bundle structure (AGENTS.md §2.7, §11), the
  // entire subsystem lives under systems/<slug>/.
  return {
    dirs: [resolve(projectRoot, "systems", slug)],
    files: [],
  };
}

async function removeSubsystem(
  slug: string,
  confirmed: boolean,
): Promise<void> {
  validateIdentifier(slug, "subsystem slug");

  if (!existsSync(resolve(projectRoot, "systems", slug))) {
    console.error(
      `[isolation-guard] systems/${slug}/ does not exist. Nothing to remove.`,
    );
    process.exit(1);
  }

  assertTestMode();

  const { dirs, files } = collectSubsystemTargets(slug);
  const existingDirs = dirs.filter(existsSync);
  const existingFiles = files.filter(existsSync);

  const db = await getDb();
  try {
    const existing = await db.query<[{ id: unknown }[]]>(
      "SELECT id FROM system WHERE slug = $slug",
      { slug },
    );
    const rawId = existing[0]?.[0]?.id;
    const systemRowId = rawId == null ? null : String(rawId);

    runRemoval({
      kind: "subsystem",
      identifier: slug,
      camel: toCamel(slug),
      dirs: existingDirs,
      files: existingFiles,
      indexFile: resolve(projectRoot, "systems", "index.ts"),
      importSpecifier: `./${slug}/register`,
      frontendIndexFile: resolve(projectRoot, "systems", "frontend.ts"),
      frontendImportSpecifier: `./${slug}/src/frontend`,
      confirmed,
      dbRowLabel: systemRowId
        ? `system (id=${systemRowId}, slug=${slug})`
        : null,
    });

    if (confirmed && systemRowId) {
      try {
        await db.query("DELETE system WHERE slug = $slug", { slug });
      } catch (err) {
        console.error(
          `[isolation-guard] Failed to DELETE system row for slug "${slug}": ${
            (err as Error).message
          }`,
        );
      }
    }
  } finally {
    await closeDb();
  }
}

function removeFramework(name: string, confirmed: boolean): void {
  validateIdentifier(name, "framework name");

  const frameworkRoot = resolve(projectRoot, "frameworks", name);
  if (!existsSync(frameworkRoot)) {
    console.error(
      `[isolation-guard] frameworks/${name}/ does not exist. Nothing to remove.`,
    );
    process.exit(1);
  }

  const existingDirs = [frameworkRoot].filter(existsSync);

  runRemoval({
    kind: "framework",
    identifier: name,
    camel: toCamel(name),
    dirs: existingDirs,
    files: [],
    indexFile: resolve(projectRoot, "frameworks", "index.ts"),
    importSpecifier: `./${name}/register`,
    frontendIndexFile: resolve(projectRoot, "frameworks", "frontend.ts"),
    frontendImportSpecifier: `./${name}/src/frontend`,
    confirmed,
  });
}

function runRemoval(params: {
  kind: Kind;
  identifier: string;
  camel: string;
  dirs: string[];
  files: string[];
  indexFile: string;
  importSpecifier: string;
  confirmed: boolean;
  dbRowLabel?: string | null;
  frontendIndexFile?: string;
  frontendImportSpecifier?: string;
}): void {
  const {
    kind,
    identifier,
    camel,
    dirs,
    files,
    indexFile,
    importSpecifier,
    confirmed,
    frontendIndexFile,
    frontendImportSpecifier,
    dbRowLabel,
  } = params;
  const alias = aliasFor(kind, camel);
  const status = confirmed ? "removed" : "plan";

  console.log(
    `[isolation-guard] ${
      confirmed ? "Removing" : "Removal plan for"
    } ${kind} "${identifier}":`,
  );
  console.log("");

  for (const d of dirs) reportAction("rmdir", d, status);
  for (const f of files) reportAction("rm", f, status);

  if (existsSync(indexFile)) {
    const src = readFileSync(indexFile, "utf8");
    const hasImport = src.includes(`from "${importSpecifier}"`);
    const hasCall = src.includes(`${alias}();`);
    const indexStatus = hasImport || hasCall
      ? (confirmed ? "updated" : "plan")
      : "skipped";
    reportAction("index", indexFile, indexStatus);
  }

  if (dbRowLabel) reportAction("db", dbRowLabel, status);

  if (frontendIndexFile && frontendImportSpecifier) {
    const frontendAlias = frontendAliasFor(kind, camel);
    if (existsSync(frontendIndexFile)) {
      const frontendSrc = readFileSync(frontendIndexFile, "utf8");
      const hasFrontendImport = frontendSrc.includes(
        `from "${frontendImportSpecifier}"`,
      );
      const hasFrontendCall = frontendSrc.includes(`${frontendAlias}();`);
      const frontendStatus = hasFrontendImport || hasFrontendCall
        ? (confirmed ? "updated" : "plan")
        : "skipped";
      reportAction("index", frontendIndexFile, frontendStatus);
    }
  }

  if (!confirmed) {
    console.log("");
    console.log(
      "No files were touched. Pass --yes to confirm the removal, e.g.:",
    );
    const flag = kind === "subsystem"
      ? "--remove-subsystem"
      : "--remove-framework";
    console.log(`  ${CLI} ${flag} ${identifier} --yes`);
    process.exit(2);
  }

  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch (err) {
      console.error(
        `[isolation-guard] Failed to remove ${d}: ${(err as Error).message}`,
      );
    }
  }
  for (const f of files) {
    try {
      rmSync(f, { force: true });
    } catch (err) {
      console.error(
        `[isolation-guard] Failed to remove ${f}: ${(err as Error).message}`,
      );
    }
  }

  unwireRegisterFromIndex({ indexFile, alias, importSpecifier });

  if (frontendIndexFile && frontendImportSpecifier) {
    const frontendAlias = frontendAliasFor(kind, camel);
    unwireRegisterFromIndex({
      indexFile: frontendIndexFile,
      alias: frontendAlias,
      importSpecifier: frontendImportSpecifier,
      importedName: "registerFrontend",
    });
  }

  console.log("");
  console.log(
    `[isolation-guard] ${kind} "${identifier}" removed. Review "git status" to confirm the diff before committing.`,
  );
}

/* -------------------------------------------------------------------- */
/* index.ts wiring / un-wiring                                          */
/* -------------------------------------------------------------------- */

function wireRegisterIntoIndex(params: {
  indexFile: string;
  kind: Kind;
  camel: string;
  importSpecifier: string;
  aggregatorFn: string;
  importedName?: string; // default "register" (server); pass "registerFrontend" for frontend
}): void {
  const { indexFile, kind, camel, importSpecifier, aggregatorFn } = params;
  const importedName = params.importedName ?? "register";
  const alias = importedName === "registerFrontend"
    ? frontendAliasFor(kind, camel)
    : aliasFor(kind, camel);
  const importLine =
    `import { ${importedName} as ${alias} } from "${importSpecifier}";`;
  const callLine = `  ${alias}();`;

  if (!existsSync(indexFile)) {
    console.error(
      `[isolation-guard] index file not found: ${indexFile}. Skipping registration wiring.`,
    );
    return;
  }

  let src = readFileSync(indexFile, "utf8");
  let changed = false;

  // 1. Insert the import if absent. Place after the last existing import,
  //    or after the leading comment block when no imports exist yet.
  if (!src.includes(importLine)) {
    const importRegex = /^import .+?;$/gm;
    const matches = [...src.matchAll(importRegex)];
    if (matches.length > 0) {
      const last = matches[matches.length - 1];
      const insertAt = (last.index ?? 0) + last[0].length;
      src = src.slice(0, insertAt) + "\n" + importLine + src.slice(insertAt);
    } else {
      const lines = src.split("\n");
      let i = 0;
      while (
        i < lines.length &&
        (lines[i].trimStart().startsWith("//") || lines[i].trim() === "")
      ) {
        i++;
      }
      const head = lines.slice(0, i);
      const rest = lines.slice(i);
      while (head.length > 0 && head[head.length - 1].trim() === "") {
        head.pop();
      }
      src = [...head, "", importLine, "", ...rest].join("\n");
    }
    changed = true;
  }

  // 2. Insert the call inside the aggregator if absent.
  if (!src.includes(`${alias}();`)) {
    const fnOpenRegex = new RegExp(
      `export function ${aggregatorFn}\\(\\): void \\{`,
    );
    const openMatch = src.match(fnOpenRegex);
    if (!openMatch || openMatch.index === undefined) {
      console.error(
        `[isolation-guard] ${aggregatorFn} not found in ${indexFile}. Append the call manually:`,
      );
      console.error(`  ${callLine}`);
      if (changed) writeFileSync(indexFile, src, "utf8");
      reportAction("index", indexFile, "manual");
      return;
    }
    const bodyStart = openMatch.index + openMatch[0].length;
    const closeIndex = src.indexOf("\n}", bodyStart);
    if (closeIndex === -1) {
      console.error(
        `[isolation-guard] Could not locate the closing brace of ${aggregatorFn}. Append the call manually:`,
      );
      console.error(`  ${callLine}`);
      if (changed) writeFileSync(indexFile, src, "utf8");
      reportAction("index", indexFile, "manual");
      return;
    }
    src = src.slice(0, closeIndex) + "\n" + callLine + src.slice(closeIndex);
    changed = true;
  }

  if (changed) {
    writeFileSync(indexFile, src, "utf8");
    reportAction("index", indexFile, "updated");
  } else {
    reportAction("index", indexFile, "skipped");
  }
}

function unwireRegisterFromIndex(params: {
  indexFile: string;
  alias: string;
  importSpecifier: string;
  importedName?: string; // default "register" (server); pass "registerFrontend" for frontend
}): void {
  const { indexFile, alias, importSpecifier } = params;
  const importedName = params.importedName ?? "register";
  if (!existsSync(indexFile)) return;

  let src = readFileSync(indexFile, "utf8");
  let changed = false;

  const importRegex = new RegExp(
    String
      .raw`^import \{ ${importedName} as ${alias} \} from "${importSpecifier}";\r?\n?`,
    "gm",
  );
  if (importRegex.test(src)) {
    src = src.replace(importRegex, "");
    changed = true;
  }

  const callRegex = new RegExp(String.raw`^\s*${alias}\(\);\s*\r?\n?`, "gm");
  if (callRegex.test(src)) {
    src = src.replace(callRegex, "");
    changed = true;
  }

  // Collapse runs of 3+ blank lines left by the deletions.
  src = src.replace(/\n{3,}/g, "\n\n");

  if (changed) writeFileSync(indexFile, src, "utf8");
}

/* -------------------------------------------------------------------- */
/* Entry point                                                          */
/* -------------------------------------------------------------------- */

async function main(): Promise<void> {
  const { mode, target, displayName, confirmed } = parseArgs(process.argv);
  switch (mode) {
    case "list":
      runListMode();
      break;
    case "create-subsystem": {
      const slug = validateIdentifier(target, "subsystem slug");
      if (!displayName || displayName.trim().length === 0) {
        printSystemSlugExplainer(slug);
      }
      await createSubsystem(slug, displayName.trim());
      break;
    }
    case "create-framework":
      createFramework(validateIdentifier(target, "framework name"));
      break;
    case "remove-subsystem":
      await removeSubsystem(
        validateIdentifier(target, "subsystem slug"),
        confirmed,
      );
      break;
    case "remove-framework":
      removeFramework(
        validateIdentifier(target, "framework name"),
        confirmed,
      );
      break;
  }
}

main().catch((err) => {
  console.error(`[isolation-guard] Unhandled error: ${(err as Error).message}`);
  process.exit(1);
});
