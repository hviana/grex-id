import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { closeDb, getDb } from "../../server/db/connection.ts";
import { runMigrations } from "../../server/db/migrations/runner.ts";
import { runSeeds } from "../../server/db/seeds/runner.ts";
import dbConfig from "../../database.json" with { type: "json" };
import process from "node:process";

// ---------------------------------------------------------------------------
// Test-mode guard.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Query normalization.
//
// Strips encoding artifacts and whitespace noise that corrupt SurrealDB
// queries silently — BOM, CRLF, trailing junk. Applied before DDL check and
// before sending to the database so the user always sees what was actually
// sent.
// ---------------------------------------------------------------------------

function normalizeQuery(raw: string): string {
  let q = raw;
  // Strip UTF-8 BOM.
  if (q.charCodeAt(0) === 0xfeff) q = q.slice(1);
  // Normalize CRLF → LF.
  q = q.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // Strip trailing whitespace per line.
  q = q.replace(/[ \t]+$/gm, "");
  // Collapse 3+ consecutive blank lines into 2 (keeps paragraph breaks).
  q = q.replace(/\n{3,}/g, "\n\n");
  // Trim leading/trailing whitespace.
  q = q.trim();
  return q;
}

// ---------------------------------------------------------------------------
// SurrealDB 3.0 syntax warnings.
//
// These are printed to stderr as non-blocking warnings. They catch the most
// common foot-guns that silently produce wrong results rather than errors.
// ---------------------------------------------------------------------------

interface SyntaxWarning {
  code: string;
  message: string;
}

function checkSyntaxWarnings(sql: string): SyntaxWarning[] {
  const warnings: SyntaxWarning[] = [];

  // Strip comments for analysis.
  const stripped = sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  // --- W1: bare `value` in SELECT column list ---
  // `value` is a SurrealQL reserved keyword. In SurrealDB 3.0 it cannot
  // appear as a bare column name — it must be backtick-quoted. This regex
  // looks for SELECT ... value ... FROM patterns where `value` is not
  // inside backticks and not part of a larger identifier.
  const selectBlocks = stripped.match(/SELECT\s+([\s\S]*?)\s+FROM\b/gi);
  if (selectBlocks) {
    for (const block of selectBlocks) {
      const cols = block.replace(/^SELECT\s+/i, "").replace(/\s+FROM\b.*/i, "");
      // Tokenize column list by commas (rough but catches the common case).
      const tokens = cols.split(",");
      for (const token of tokens) {
        const trimmed = token.trim();
        // Match bare `value` (not `value.something`, not `` `value` ``, not
        // inside a function call like `count()`).
        if (/^\bvalue\b$/i.test(trimmed)) {
          warnings.push({
            code: "W_BARE_VALUE",
            message:
              `"value" is a SurrealDB reserved keyword. In SELECT column lists,` +
              ` use \`value\` (backtick-quoted) or SELECT * instead.` +
              ` Bare \`value\` silently returns NULL in SurrealDB 3.0.`,
          });
          break; // one warning per SELECT is enough
        }
      }
    }
  }

  // --- W2: FETCH after LIMIT ---
  // SurrealDB requires: SELECT ... LIMIT n FETCH ... (FETCH after LIMIT is
  // silently ignored in some versions). Correct order is FETCH before LIMIT
  // in SurrealDB 3.0.
  if (/\bLIMIT\b.*\bFETCH\b/is.test(stripped)) {
    warnings.push({
      code: "W_FETCH_AFTER_LIMIT",
      message:
        `FETCH appears after LIMIT. In SurrealDB 3.0 the correct order is` +
        ` SELECT ... FETCH ... LIMIT .... FETCH after LIMIT may be silently ignored.`,
    });
  }

  // --- W3: nested IF without parentheses ---
  // SurrealDB 3.0 requires parenthesization of nested IF blocks, regardless
  // of which syntax form is used:
  //   Brace form:   IF cond { ... } ELSE { ... }
  //   THEN form:    IF cond THEN ... ELSE ... END
  // A nested IF (one appearing inside another IF's body) must be wrapped:
  //   (IF cond THEN ... ELSE ... END)
  // We detect two patterns:
  //   (a) IF inside a { } block (brace depth >= 1) — not parenthesized
  //   (b) "ELSE IF" on the same line — the inner IF is not parenthesized
  const lines = stripped.split("\n");
  let braceDepth = 0;
  let thenIfDepth = 0; // tracks IF/THEN...END nesting without braces
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Snapshot depths before counting this line's braces.
    const lineBraceDepth = braceDepth;
    // Count braces.
    for (const ch of line) {
      if (ch === "{") braceDepth++;
      if (ch === "}") braceDepth--;
    }
    // (a) Brace-form nested IF: IF keyword inside a { } block.
    if (lineBraceDepth >= 1) {
      const hasBareIf = /\bIF\b/i.test(line) && !/\(\s*IF\b/i.test(line);
      if (hasBareIf) {
        warnings.push({
          code: "W_NESTED_IF_UNPARENTHESIZED",
          message: `Nested IF found at line ${i + 1} without parentheses.` +
            ` SurrealDB 3.0 requires parenthesizing nested IF expressions:` +
            ` (IF ... { ... } ELSE { ... }).`,
        });
        break;
      }
    }
    // (b) THEN-form nested IF: "ELSE IF" on the same line means a bare
    //     nested IF without parens. Correct: "ELSE (IF ...".
    //     Track IF/END depth to also catch cases where END closes an inner IF
    //     and the outer IF still expects one more END.
    if (/\bELSE\s+IF\b/i.test(line) && !/\bELSE\s*\(\s*IF\b/i.test(line)) {
      warnings.push({
        code: "W_NESTED_IF_UNPARENTHESIZED",
        message: `Nested IF found at line ${i + 1} without parentheses` +
          ` ("ELSE IF" pattern). SurrealDB 3.0 requires wrapping the inner IF:` +
          ` ELSE (IF ... THEN ... ELSE ... END).`,
      });
      break;
    }
    // Track THEN-form IF/END depth for context.
    const ifMatches = line.match(/\bIF\b/gi);
    const endMatches = line.match(/\bEND\b/gi);
    if (ifMatches) thenIfDepth += ifMatches.length;
    if (endMatches) thenIfDepth -= endMatches.length;
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// DDL blocker.
//
// Only blocks on comments + code. The `sql` parameter must already be
// normalized (BOM, CRLF stripped).
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// CLI parsing.
// ---------------------------------------------------------------------------

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
      "  binding. For ad-hoc queries, use `type::record` inline:",
      '    SELECT * FROM type::record("user", "abc");',
      "  or:",
      "    LET $id = type::record($table, $key); SELECT * FROM $id;",
      "",
      "Syntax warnings:",
      "  The runner checks for common SurrealDB 3.0 foot-guns and prints",
      "  warnings to stderr before executing. These are non-blocking:",
      "    - bare `value` in SELECT (reserved keyword — backtick-quote it)",
      "    - FETCH after LIMIT (may be silently ignored)",
      "    - unparenthesized nested IF (must wrap in parentheses)",
    ].join("\n"),
  );
}

// ---------------------------------------------------------------------------
// Serialization.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Bootstrap — auto-initialize if the database is empty.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Error-context printer.
//
// When a query fails, dumps the normalized query and bindings to stderr so
// the user can see exactly what was sent to SurrealDB.
// ---------------------------------------------------------------------------

function printErrorContext(
  query: string,
  bindings: Record<string, unknown>,
  err: unknown,
): void {
  console.error("[test-db-queries] query failed:");
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(msg);
  console.error("");
  console.error("--- query sent to SurrealDB ---");
  // Print with line numbers for easy reference.
  const lines = query.split("\n");
  const width = String(lines.length).length;
  for (let i = 0; i < lines.length; i++) {
    console.error(`${String(i + 1).padStart(width)} | ${lines[i]}`);
  }
  console.error("--- end query ---");
  if (Object.keys(bindings).length > 0) {
    console.error("");
    console.error("--- bindings ---");
    console.error(JSON.stringify(bindings, null, 2));
    console.error("--- end bindings ---");
  }
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

// The parsed args and normalized query are stored here so the catch handler
// can print them as error context. Only parseArgs once — stdin is consumed
// on first read and cannot be re-read.
let lastQuery: string | undefined;
let lastBindings: Record<string, unknown> = {};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  lastBindings = args.bindings;

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.query || !args.query.trim()) {
    console.error("[test-db-queries] no query provided.\n");
    printHelp();
    process.exit(1);
  }

  // Normalize before any analysis.
  const query = normalizeQuery(args.query);
  lastQuery = query;

  assertNoDDL(query);

  // Print syntax warnings (non-blocking).
  const warnings = checkSyntaxWarnings(query);
  for (const w of warnings) {
    console.error(`[test-db-queries] ${w.code}: ${w.message}`);
  }

  await ensureDatabaseReady();

  const db = await getDb();
  const result = await db.query(query, args.bindings);
  console.log(stringify(result, args.pretty));
}

main()
  .then(() => closeDb())
  .catch(async (err: unknown) => {
    if (lastQuery) {
      printErrorContext(lastQuery, lastBindings, err);
    } else {
      console.error("[test-db-queries] query failed:");
      console.error(
        err instanceof Error ? err.stack ?? err.message : String(err),
      );
    }
    await closeDb().catch(() => {});
    process.exit(1);
  });
