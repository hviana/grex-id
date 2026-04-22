import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";

/**
 * isolation-guard — PRIORITY 1 skill.
 *
 * Two modes:
 *
 *   1. No flags (default) — dynamically lists existing frameworks and
 *      subsystems, explains the three layers, and exits with code 2 so the
 *      caller knows work is blocked pending the user's declaration.
 *
 *   2. --create-subsystem <slug>  OR  --create-framework <name>
 *      Scaffolds the full folder structure mandated by the root AGENTS.md
 *      (§6 for subsystems, §26.1 for frameworks), adding .gitkeep to every
 *      empty directory, writing a stub register.ts and a stub AGENTS.md,
 *      creating empty i18n JSON files, and wiring the new entry into the
 *      matching index.ts (systems/index.ts or frameworks/index.ts).
 *
 * Runtime-agnostic: only uses `node:*` built-ins, same shape Deno accepts.
 */

const projectRoot = resolve(new URL(".", import.meta.url).pathname, "..", "..");

function listDirectChildren(dirAbs: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dirAbs);
  } catch {
    return [];
  }
  const result: string[] = [];
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const full = resolve(dirAbs, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) result.push(name);
  }
  return result.sort((a, b) => a.localeCompare(b));
}

function parseArgs(argv: string[]): {
  mode: "list" | "create-subsystem" | "create-framework";
  target?: string;
} {
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--create-subsystem" || a === "-s") {
      return { mode: "create-subsystem", target: args[i + 1] };
    }
    if (a === "--create-framework" || a === "-f") {
      return { mode: "create-framework", target: args[i + 1] };
    }
  }
  return { mode: "list" };
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
  const entries = readdirSync(dirAbs);
  if (entries.length === 0) {
    const keep = resolve(dirAbs, ".gitkeep");
    writeFileSync(keep, "", "utf8");
    return "created";
  }
  return "skipped";
}

function reportFile(label: string, abs: string, result: string): void {
  const rel = abs.replace(projectRoot + "/", "");
  console.log(`  [${result}] ${label.padEnd(12)} ${rel}`);
}

/* -------------------------------------------------------------------- */
/* Default mode — list existing layers and block                        */
/* -------------------------------------------------------------------- */

function runListMode(): never {
  const frameworks = listDirectChildren(resolve(projectRoot, "frameworks"));
  const subsystems = listDirectChildren(resolve(projectRoot, "systems"));

  const lines: string[] = [];
  lines.push("[isolation-guard] BLOCKING — target layer not specified.");
  lines.push("");
  lines.push(
    "Every change in this project must belong to exactly ONE of three layers.",
  );
  lines.push(
    "You must tell me which layer this work belongs to before I start.",
  );
  lines.push("");
  lines.push("The three layers:");
  lines.push("");
  lines.push(
    "  1. Core        — the platform foundation at the project root. Shared",
  );
  lines.push(
    "                   rules, tables, routes, components, settings. Knows",
  );
  lines.push(
    "                   nothing about any specific subsystem or framework.",
  );
  lines.push("");
  lines.push(
    "  2. Subsystem   — a runtime tenant / product. Lives under a `[slug]`",
  );
  lines.push(
    "                   subfolder inside every relevant root (app/api/systems/,",
  );
  lines.push(
    "                   src/components/systems/, server/db/queries/systems/,",
  );
  lines.push(
    "                   src/i18n/<locale>/systems/, systems/<slug>/). Consumes",
  );
  lines.push(
    "                   Core and any frameworks it declares. Never extends Core.",
  );
  lines.push("");
  lines.push(
    "  3. Framework   — a reusable, design-time extension of Core. Lives under",
  );
  lines.push(
    "                   frameworks/<name>/ with its own AGENTS.md, routes at",
  );
  lines.push(
    "                   /api/<name>/..., components, migrations, queries, i18n,",
  );
  lines.push(
    "                   seeds, and register.ts. Consumed by zero or more",
  );
  lines.push(
    "                   subsystems. Never imports from Core internals, other",
  );
  lines.push("                   frameworks, or any subsystem.");
  lines.push("");
  lines.push("  Layering is one-way:  Core  <=  Frameworks  <=  Subsystems");
  lines.push("");
  lines.push("Currently existing subsystems (under systems/):");
  if (subsystems.length === 0) {
    lines.push("  (none)");
  } else {
    for (const s of subsystems) lines.push(`  - ${s}`);
  }
  lines.push("");
  lines.push("Currently existing frameworks (under frameworks/):");
  if (frameworks.length === 0) {
    lines.push("  (none)");
  } else {
    for (const f of frameworks) lines.push(`  - ${f}`);
  }
  lines.push("");
  lines.push("Please answer with ONE of:");
  lines.push('  - "in Core"');
  lines.push('  - "in the <slug> subsystem"            (pick from the list)');
  lines.push('  - "in the <name> framework"             (pick from the list)');
  lines.push('  - "create a new subsystem called <slug>"');
  lines.push('  - "create a new framework called <name>"');
  lines.push("");
  lines.push(
    "To scaffold a new subsystem/framework run this same skill with:",
  );
  lines.push(
    "  tsx skills/isolation-guard/run.ts --create-subsystem <slug>",
  );
  lines.push(
    "  tsx skills/isolation-guard/run.ts --create-framework <name>",
  );
  lines.push("");
  lines.push("I will not read, write, or plan anything until you reply.");

  console.log(lines.join("\n"));
  process.exit(2);
}

/* -------------------------------------------------------------------- */
/* Subsystem scaffold                                                   */
/* -------------------------------------------------------------------- */

function subsystemRegisterStub(slug: string, camel: string): string {
  return `import { registerSystemI18n } from "@/server/module-registry";
import en${camel} from "@/src/i18n/en/systems/${slug}.json";
import ptBR${camel} from "@/src/i18n/pt-BR/systems/${slug}.json";

export function register(): void {
  // Event handlers — registerHandler("<event_name>", handlerFn);

  // Components — registerComponent("<componentName>", () => import("@/src/components/systems/${slug}/Foo"));

  // Homepage — registerHomePage("${slug}", () => import("@/src/components/systems/${slug}/HomePage"));

  // i18n
  registerSystemI18n("${slug}", "en", en${camel});
  registerSystemI18n("${slug}", "pt-BR", ptBR${camel});

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

function toCamel(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}

function createSubsystem(slug: string): void {
  validateIdentifier(slug, "subsystem slug");
  const camel = toCamel(slug);

  console.log(`[isolation-guard] Scaffolding subsystem "${slug}"...`);
  console.log("");

  const systemRoot = resolve(projectRoot, "systems", slug);
  if (existsSync(systemRoot)) {
    console.error(
      `[isolation-guard] systems/${slug}/ already exists. Aborting to avoid overwriting existing work.`,
    );
    process.exit(1);
  }

  // 1. Files with content.
  const fileTargets: { label: string; path: string; content: string }[] = [
    {
      label: "file",
      path: resolve(projectRoot, "systems", slug, "register.ts"),
      content: subsystemRegisterStub(slug, camel),
    },
    {
      label: "file",
      path: resolve(projectRoot, "systems", slug, "AGENTS.md"),
      content: subsystemAgentsStub(slug),
    },
    {
      label: "i18n",
      path: resolve(
        projectRoot,
        "src",
        "i18n",
        "en",
        "systems",
        `${slug}.json`,
      ),
      content: "{}\n",
    },
    {
      label: "i18n",
      path: resolve(
        projectRoot,
        "src",
        "i18n",
        "pt-BR",
        "systems",
        `${slug}.json`,
      ),
      content: "{}\n",
    },
  ];
  for (const t of fileTargets) {
    const r = writeIfAbsent(t.path, t.content);
    reportFile(t.label, t.path, r);
  }

  // 2. Directories that must exist per §6 — .gitkeep when empty.
  const dirTargets: string[] = [
    "src/components/systems/" + slug,
    "server/db/migrations/systems/" + slug,
    "server/db/queries/systems/" + slug,
    "server/db/frontend-queries/systems/" + slug,
    "server/event-queue/handlers/systems/" + slug,
    "app/api/systems/" + slug,
    "public/systems/" + slug,
  ];
  for (const rel of dirTargets) {
    const abs = resolve(projectRoot, rel);
    const r = addGitkeepIfEmpty(abs);
    reportFile("gitkeep", resolve(abs, ".gitkeep"), r);
  }

  // 3. Wire into systems/index.ts.
  wireRegisterIntoIndex({
    indexFile: resolve(projectRoot, "systems", "index.ts"),
    identifier: slug,
    kind: "subsystem",
    camel,
    importSpecifier: `./${slug}/register`,
    aggregatorFn: "registerAllSystems",
  });

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
    `  - Place routes under app/api/systems/${slug}/, queries under server/db/queries/systems/${slug}/, etc.`,
  );
}

/* -------------------------------------------------------------------- */
/* Framework scaffold                                                   */
/* -------------------------------------------------------------------- */

function frameworkRegisterStub(name: string): string {
  return `// Framework register entry point (§26.4).

export function register(): void {
  // Event handlers — registerHandler("<event_name>", handlerFn);
  // Communication channels — registerChannel("<channel>"); registerHandler("send_<channel>", fn);
  // Templates — registerTemplate("<channel>", "<path>", fn) or registerTemplateBuilder("<name>", fn).
  // Caches — registerCache("${name}", "<cache-name>", loader);
  // Lifecycle hooks — registerLifecycleHook("lead:delete", fn);
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

function createFramework(name: string): void {
  validateIdentifier(name, "framework name");

  console.log(`[isolation-guard] Scaffolding framework "${name}"...`);
  console.log("");

  const frameworkRoot = resolve(projectRoot, "frameworks", name);
  if (existsSync(frameworkRoot) && readdirSync(frameworkRoot).length > 0) {
    console.error(
      `[isolation-guard] frameworks/${name}/ already exists and is non-empty. Aborting to avoid overwriting existing work.`,
    );
    process.exit(1);
  }

  // 1. Files with content.
  const fileTargets: { label: string; path: string; content: string }[] = [
    {
      label: "file",
      path: resolve(projectRoot, "frameworks", name, "AGENTS.md"),
      content: frameworkAgentsStub(name),
    },
    {
      label: "file",
      path: resolve(projectRoot, "frameworks", name, "register.ts"),
      content: frameworkRegisterStub(name),
    },
    {
      label: "i18n",
      path: resolve(
        projectRoot,
        "frameworks",
        name,
        "src",
        "i18n",
        "en",
        `${name}.json`,
      ),
      content: "{}\n",
    },
    {
      label: "i18n",
      path: resolve(
        projectRoot,
        "frameworks",
        name,
        "src",
        "i18n",
        "pt-BR",
        `${name}.json`,
      ),
      content: "{}\n",
    },
  ];
  for (const t of fileTargets) {
    const r = writeIfAbsent(t.path, t.content);
    reportFile(t.label, t.path, r);
  }

  // 2. Directories mandated by §26.1 — .gitkeep when empty.
  const dirTargets: string[] = [
    `frameworks/${name}/app/api/${name}`,
    `frameworks/${name}/src/components/${name}`,
    `frameworks/${name}/src/contracts`,
    `frameworks/${name}/server/db/migrations`,
    `frameworks/${name}/server/db/queries`,
    `frameworks/${name}/server/db/seeds`,
    `frameworks/${name}/server/utils`,
    `frameworks/${name}/public/${name}`,
  ];
  for (const rel of dirTargets) {
    const abs = resolve(projectRoot, rel);
    const r = addGitkeepIfEmpty(abs);
    reportFile("gitkeep", resolve(abs, ".gitkeep"), r);
  }

  // 3. Wire into frameworks/index.ts.
  wireRegisterIntoIndex({
    indexFile: resolve(projectRoot, "frameworks", "index.ts"),
    identifier: name,
    kind: "framework",
    camel: toCamel(name),
    importSpecifier: `./${name}/register`,
    aggregatorFn: "registerAllFrameworks",
  });

  console.log("");
  console.log(`[isolation-guard] Framework "${name}" scaffolded.`);
  console.log("Next steps:");
  console.log(`  - Fill in frameworks/${name}/register.ts.`);
  console.log(
    `  - Update frameworks/${name}/AGENTS.md with framework-specific rules.`,
  );
  console.log(
    `  - Place routes under frameworks/${name}/app/api/${name}/, queries under frameworks/${name}/server/db/queries/, etc.`,
  );
}

/* -------------------------------------------------------------------- */
/* index.ts wiring                                                      */
/* -------------------------------------------------------------------- */

function wireRegisterIntoIndex(params: {
  indexFile: string;
  identifier: string;
  kind: "subsystem" | "framework";
  camel: string;
  importSpecifier: string;
  aggregatorFn: string;
}): void {
  const { indexFile, identifier, kind, camel, importSpecifier, aggregatorFn } =
    params;
  const aliasSuffix = kind === "subsystem" ? `${camel}` : `${camel}Framework`;
  const alias = `register${aliasSuffix}`;
  const importLine =
    `import { register as ${alias} } from "${importSpecifier}";`;
  const callLine = `  ${alias}();`;

  if (!existsSync(indexFile)) {
    console.error(
      `[isolation-guard] index file not found: ${indexFile}. Skipping registration wiring.`,
    );
    return;
  }

  let src = readFileSync(indexFile, "utf8");

  if (src.includes(importLine)) {
    reportFile("index", indexFile, "skipped");
    return;
  }

  // Insert the import after the last existing import. If no imports exist,
  // place it after the leading comment block (if any) with a blank line
  // separator, so the file keeps its banner comment on top.
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
    // Strip trailing blank lines from head so we can reinsert exactly one.
    while (head.length > 0 && head[head.length - 1].trim() === "") head.pop();
    src = [...head, "", importLine, "", ...rest].join("\n");
  }

  // Insert the call before the closing `}` of the aggregator function.
  const fnOpenRegex = new RegExp(
    `export function ${aggregatorFn}\\(\\): void \\{`,
  );
  const openMatch = src.match(fnOpenRegex);
  if (!openMatch || openMatch.index === undefined) {
    console.error(
      `[isolation-guard] ${aggregatorFn} not found in ${indexFile}. Append the call manually:`,
    );
    console.error(`  ${callLine}`);
    reportFile("index", indexFile, "manual");
    writeFileSync(indexFile, src, "utf8");
    return;
  }
  const bodyStart = openMatch.index + openMatch[0].length;
  const closeIndex = src.indexOf("\n}", bodyStart);
  if (closeIndex === -1) {
    console.error(
      `[isolation-guard] Could not locate the closing brace of ${aggregatorFn}. Append the call manually:`,
    );
    console.error(`  ${callLine}`);
    reportFile("index", indexFile, "manual");
    writeFileSync(indexFile, src, "utf8");
    return;
  }
  src = src.slice(0, closeIndex) + "\n" + callLine + src.slice(closeIndex);

  writeFileSync(indexFile, src, "utf8");
  reportFile("index", indexFile, "updated");
}

/* -------------------------------------------------------------------- */
/* Entry point                                                          */
/* -------------------------------------------------------------------- */

const { mode, target } = parseArgs(process.argv);
if (mode === "list") {
  runListMode();
} else if (mode === "create-subsystem") {
  createSubsystem(validateIdentifier(target, "subsystem slug"));
} else if (mode === "create-framework") {
  createFramework(validateIdentifier(target, "framework name"));
}
