import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { closeDb, getDb } from "../../server/db/connection.ts";
import { runMigrations } from "../../server/db/migrations/runner.ts";
import { runSeeds } from "../../server/db/seeds/runner.ts";
import dbConfig from "../../database.json" with { type: "json" };
import process from "node:process";

/**
 * Test-mode guard.
 *
 * Hard-refuses to run when `database.json` does not carry `"test": true`.
 * This is deterministic: no env var override, no flag, no "I know what I'm
 * doing" path. Flip the flag in `database.json` before using this skill.
 */
const isTestMode = (dbConfig as { test?: unknown }).test === true;
if (!isTestMode) {
  console.error(
    [
      "[test-db-queries] REFUSING TO RUN.",
      "",
      'database.json does not have `"test": true`.',
      "",
      "This skill mutates live data. It only runs against a database that has",
      "been explicitly marked as a test target. To proceed:",
      "",
      "  1. Confirm the database in database.json is a TEST database,",
      "     never production.",
      '  2. Set `"test": true` in database.json.',
      "  3. Re-run this command.",
      "",
      '  When you are done testing, flip it back to `"test": false`.',
    ].join("\n"),
  );
  process.exit(2);
}

/**
 * DDL blocker.
 *
 * This skill is for CRUD only (SELECT / CREATE / UPDATE / UPSERT / DELETE /
 * INSERT / RELATE / LET / IF / FOR / transactions). Any statement that would
 * change the schema — DEFINE / REMOVE / ALTER — is refused. Schema changes
 * belong in migration files under server/db/migrations/.
 */
function assertNoDDL(sql: string): void {
  const stripped = sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  const forbidden = /\b(DEFINE|REMOVE|ALTER)\b/i;
  const match = stripped.match(forbidden);
  if (match) {
    console.error(
      [
        `[test-db-queries] DDL keyword "${
          match[0].toUpperCase()
        }" is forbidden.`,
        "",
        "DEFINE / REMOVE / ALTER are blocked. This skill only runs CRUD:",
        "SELECT, CREATE, UPDATE, UPSERT, DELETE, INSERT, RELATE, LET, IF, FOR,",
        "BEGIN / COMMIT / CANCEL TRANSACTION.",
        "",
        "Schema changes are out of scope for this skill.",
      ].join("\n"),
    );
    process.exit(3);
  }
}

interface ParsedArgs {
  query?: string;
  bindings: Record<string, unknown>;
  pretty: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { bindings: {}, pretty: true, help: false };
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-q":
      case "--query":
        out.query = argv[++i];
        break;
      case "-f":
      case "--file": {
        const p = argv[++i];
        out.query = readFileSync(resolve(process.cwd(), p), "utf-8");
        break;
      }
      case "-b":
      case "--bindings":
        out.bindings = JSON.parse(argv[++i]);
        break;
      case "--bindings-file": {
        const p = argv[++i];
        out.bindings = JSON.parse(
          readFileSync(resolve(process.cwd(), p), "utf-8"),
        );
        break;
      }
      case "--stdin":
        out.query = readFileSync(0, "utf-8");
        break;
      case "--compact":
        out.pretty = false;
        break;
      case "-h":
      case "--help":
        out.help = true;
        break;
      default:
        positional.push(a);
    }
  }

  if (!out.query && positional.length > 0) {
    out.query = positional.join(" ");
  }

  return out;
}

function printHelp(): void {
  console.log(
    [
      "Usage:",
      '  tsx skills/test-db-queries/run.ts "SELECT * FROM user LIMIT 5"',
      '  tsx skills/test-db-queries/run.ts -q "SELECT * FROM $id" -b \'{"id":"user:abc"}\'',
      "  tsx skills/test-db-queries/run.ts -f path/to/query.surql",
      "  tsx skills/test-db-queries/run.ts -f query.surql --bindings-file vars.json",
      "  echo 'SELECT * FROM user' | tsx skills/test-db-queries/run.ts --stdin",
      "",
      "Flags:",
      "  -q, --query <surql>       Inline SurrealQL.",
      "  -f, --file <path>         Read SurrealQL from a file.",
      "      --stdin               Read SurrealQL from stdin.",
      "  -b, --bindings <json>     Bindings object as a JSON string.",
      "      --bindings-file <p>   Bindings object from a JSON file.",
      "      --compact             One-line JSON output (default is pretty).",
      "  -h, --help                Show this help.",
      "",
      "Output: the raw `db.query()` return value, serialized as JSON. Each",
      "top-level array entry corresponds to one statement in the query, in",
      "order.",
      "",
      "Rules:",
      '  - database.json must carry `"test": true` (the skill refuses otherwise).',
      "  - DDL is blocked: DEFINE / REMOVE / ALTER are rejected.",
      "",
      "Binding record ids:",
      "  SurrealDB fields typed `record<table>` will not match a plain string",
      "  binding. For ad-hoc queries, use `type::thing` inline:",
      '    SELECT * FROM type::thing("user", "abc");',
      "  or:",
      "    LET $id = type::thing($table, $key); SELECT * FROM $id;",
    ].join("\n"),
  );
}

function stringify(value: unknown, pretty: boolean): string {
  const replacer = (_key: string, v: unknown): unknown => {
    if (typeof v === "bigint") return v.toString();
    if (v instanceof Date) return v.toISOString();
    if (v instanceof Map) return Object.fromEntries(v);
    if (v instanceof Set) return Array.from(v);
    if (v && typeof v === "object") {
      const obj = v as { tb?: unknown; id?: unknown };
      if (typeof obj.tb === "string" && obj.id !== undefined) {
        const innerId = typeof obj.id === "string"
          ? obj.id
          : obj.id != null
          ? String((obj.id as { String?: string }).String ?? obj.id)
          : "";
        if (innerId) return `${obj.tb}:${innerId}`;
      }
    }
    return v;
  };
  return pretty
    ? JSON.stringify(value, replacer, 2)
    : JSON.stringify(value, replacer);
}

/**
 * Bootstrap.
 *
 * "If the database doesn't exist, create it." Detection signal: the
 * `_migrations` tracking table is missing or empty — i.e. no schema has
 * been applied yet. When that's the case we run the project's migration
 * runner followed by the seed runner; otherwise we leave the database alone
 * (the assumption is the user or `npm run db:setup` already initialized it).
 *
 * The runners print progress via `console.log`, which would corrupt the
 * stdout JSON contract. We route them to stderr for the duration of the
 * bootstrap and restore stdout afterwards.
 */
async function isDatabaseInitialized(): Promise<boolean> {
  const db = await getDb();
  try {
    const result = await db.query<[{ count: number }[]]>(
      "SELECT count() FROM _migrations GROUP ALL",
    );
    const rows = result[0] ?? [];
    return rows.length > 0 && (rows[0]?.count ?? 0) > 0;
  } catch {
    return false;
  }
}

async function ensureDatabaseReady(): Promise<void> {
  if (await isDatabaseInitialized()) return;

  console.error(
    "[test-db-queries] database not initialized — running migrations + seeds...",
  );

  const originalLog = console.log;
  console.log = (...args: unknown[]) => console.error(...args);
  try {
    await runMigrations();
    await runSeeds();
  } finally {
    console.log = originalLog;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.query || !args.query.trim()) {
    console.error("[test-db-queries] no query provided.\n");
    printHelp();
    process.exit(1);
  }

  assertNoDDL(args.query);

  await ensureDatabaseReady();

  const db = await getDb();
  const result = await db.query(args.query, args.bindings);
  console.log(stringify(result, args.pretty));
}

main()
  .then(() => closeDb())
  .catch(async (err: unknown) => {
    console.error("[test-db-queries] query failed:");
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    console.error(msg);
    await closeDb().catch(() => {});
    process.exit(1);
  });
