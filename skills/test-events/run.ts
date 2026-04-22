import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { closeDb, getDb, rid } from "../../server/db/connection.ts";
import { runMigrations } from "../../server/db/migrations/runner.ts";
import { runSeeds } from "../../server/db/seeds/runner.ts";
import dbConfig from "../../database.json" with { type: "json" };

/**
 * Test-mode guard.
 *
 * Hard-refuses to run when `database.json` does not carry `"test": true`.
 * Deterministic: no env var override, no flag. This skill inspects (and can
 * clear) event-queue rows and verification_request rows — it only runs
 * against a database that has been explicitly marked as a test target.
 */
const isTestMode = (dbConfig as { test?: unknown }).test === true;
if (!isTestMode) {
  console.error(
    [
      "[test-events] REFUSING TO RUN.",
      "",
      'database.json does not have `"test": true`.',
      "",
      "This skill reads (and can mutate) event-queue and verification tables",
      "against the configured database. It only runs against a database that",
      "has been explicitly marked as a test target. To proceed:",
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

const PROJECT_ROOT = resolve(import.meta.dirname ?? process.cwd(), "..", "..");
const ROUTES_SERVER_PORT = resolve(
  PROJECT_ROOT,
  "skills",
  "test-routes",
  ".server.port",
);
const FRONTEND_SERVER_PORT = resolve(
  PROJECT_ROOT,
  "skills",
  "test-frontend",
  ".server.port",
);

const DEFAULT_PORT = Number(process.env.PORT ?? 3000);
const DEFAULT_WAIT_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 500;

// ---------------------------------------------------------------------------
// Serialization — SurrealDB record ids come back as objects { tb, id }; flatten
// them into canonical "table:id" strings so downstream tooling can copy them
// directly into other queries (same approach as test-db-queries).
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
// Bootstrap — if the database has never been initialized (no rows in the
// tracking `_migrations` table) we run the project's migration + seed
// runners. Both print to stdout, which would corrupt our JSON output, so
// we reroute console.log to stderr during bootstrap.
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
    "[test-events] database not initialized — running migrations + seeds...",
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
// Dev-server bootstrap. We don't own a server of our own — event processing
// requires the dev server (and its `instrumentation.ts → startAllJobs`) so
// workers actually pull deliveries off the queue. Reuse any reachable server
// (test-routes, test-frontend); spawn a detached one only if nothing answers.
// ---------------------------------------------------------------------------

function readPortFrom(file: string): number | null {
  if (!existsSync(file)) return null;
  const raw = readFileSync(file, "utf-8").trim();
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function pingServer(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/public/front-core`);
    return res.status > 0;
  } catch {
    return false;
  }
}

async function findExistingServerBaseUrl(): Promise<string | null> {
  // Prefer sibling skills' servers first, falling back to the default port.
  const candidates: string[] = [];
  const routes = readPortFrom(ROUTES_SERVER_PORT);
  if (routes) candidates.push(`http://localhost:${routes}`);
  const front = readPortFrom(FRONTEND_SERVER_PORT);
  if (front && !candidates.some((c) => c.endsWith(`:${front}`))) {
    candidates.push(`http://localhost:${front}`);
  }
  candidates.push(`http://localhost:${DEFAULT_PORT}`);
  for (const url of candidates) {
    if (await pingServer(url)) return url;
  }
  return null;
}

async function ensureWorkerRunning(
  waitMs: number,
): Promise<{ baseUrl: string; spawned: boolean }> {
  const existing = await findExistingServerBaseUrl();
  if (existing) return { baseUrl: existing, spawned: false };

  // Delegate to test-routes for the detached server; that skill already
  // manages .server.pid / .server.port + readiness polling. This keeps the
  // "one dev server shared across skills" invariant intact.
  console.error(
    "[test-events] no dev server reachable — starting one via test-routes...",
  );

  const tsxBin = resolve(PROJECT_ROOT, "node_modules", ".bin", "tsx");
  const runScript = resolve(PROJECT_ROOT, "skills", "test-routes", "run.ts");
  if (!existsSync(tsxBin)) {
    throw new Error(
      "`tsx` is not installed in the project. Run `npm install` in the project root.",
    );
  }
  const result = spawnSync(
    tsxBin,
    [runScript, "server", "start", "--timeout", String(waitMs)],
    { cwd: PROJECT_ROOT, encoding: "utf-8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `failed to start dev server via test-routes (exit ${result.status}). ${
        result.stderr ?? ""
      }`,
    );
  }
  const port = readPortFrom(ROUTES_SERVER_PORT) ?? DEFAULT_PORT;
  const baseUrl = `http://localhost:${port}`;
  if (!(await pingServer(baseUrl))) {
    throw new Error(
      "dev server started but is not reachable. See skills/test-routes/.server.log",
    );
  }
  return { baseUrl, spawned: true };
}

// ---------------------------------------------------------------------------
// Queries. Every multi-statement query goes through one batched db.query()
// call per the project's single-call rule (§7.2).
// ---------------------------------------------------------------------------

interface DeliveryRow {
  id: string;
  handler: string;
  status: "pending" | "processing" | "done" | "dead";
  eventId: string;
  eventName: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  availableAt: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
}

interface ListFilters {
  handler?: string;
  status?: string;
  eventName?: string;
  since?: Date; // default: 5 minutes ago
  limit?: number; // default: 50
}

async function listDeliveries(filters: ListFilters): Promise<DeliveryRow[]> {
  const db = await getDb();
  const since = filters.since ??
    new Date(Date.now() - 5 * 60 * 1000);
  const limit = Math.max(1, Math.min(filters.limit ?? 50, 500));

  // One batched call: fetch candidate deliveries, then join the event payload.
  // We use a filter object because SurrealQL lacks dynamic WHERE concatenation.
  const result = await db.query<[DeliveryRow[]]>(
    `SELECT
       id,
       handler,
       status,
       eventId,
       (SELECT name FROM $parent.eventId LIMIT 1)[0].name AS eventName,
       (SELECT payload FROM $parent.eventId LIMIT 1)[0].payload AS payload,
       attempts,
       maxAttempts,
       lastError,
       availableAt,
       startedAt,
       finishedAt,
       createdAt
     FROM delivery
     WHERE createdAt >= $since
       AND ($handler = NONE OR handler = $handler)
       AND ($status = NONE OR status = $status)
     ORDER BY createdAt DESC
     LIMIT $limit`,
    {
      since,
      handler: filters.handler ?? undefined,
      status: filters.status ?? undefined,
      limit,
    },
  );

  const rows = result[0] ?? [];
  if (!filters.eventName) return rows;
  return rows.filter((r) => r.eventName === filters.eventName);
}

interface WaitArgs extends ListFilters {
  timeoutMs?: number;
  pollMs?: number;
  // If present, match only deliveries whose payload satisfies every key.
  // Strings match by equality OR substring inclusion when the stored value is
  // a string. Numbers/booleans match by equality.
  payloadContains?: Record<string, unknown>;
  recipient?: string;
  actionKey?: string;
  // After matching, wait until status matches one of these (default: any).
  status?: "pending" | "processing" | "done" | "dead";
}

function matchesPayload(
  row: DeliveryRow,
  criteria: WaitArgs,
): boolean {
  const payload = row.payload ?? {};
  if (criteria.recipient) {
    const recipients = payload.recipients;
    const found = Array.isArray(recipients) &&
      recipients.some((r) => typeof r === "string" && r === criteria.recipient);
    if (!found) return false;
  }
  if (criteria.actionKey) {
    const td = (payload.templateData as Record<string, unknown>) ?? {};
    if (td.actionKey !== criteria.actionKey) return false;
  }
  if (criteria.payloadContains) {
    for (const [k, v] of Object.entries(criteria.payloadContains)) {
      const actual = getByPath(payload, k);
      if (typeof v === "string" && typeof actual === "string") {
        if (!actual.includes(v) && actual !== v) return false;
      } else if (actual !== v) return false;
    }
  }
  return true;
}

function getByPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const segments = path.split(".");
  let current: unknown = obj;
  for (const seg of segments) {
    if (current && typeof current === "object" && seg in (current as object)) {
      current = (current as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return current;
}

async function waitForDelivery(
  args: WaitArgs,
): Promise<{ matched: DeliveryRow | null; waited: number; checked: number }> {
  const timeoutMs = args.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const pollMs = args.pollMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  const since = args.since ?? new Date(Date.now() - 2 * 60 * 1000);
  let checked = 0;

  while (Date.now() < deadline) {
    const rows = await listDeliveries({
      handler: args.handler,
      status: args.status,
      eventName: args.eventName,
      since,
      limit: args.limit ?? 100,
    });
    checked = rows.length;
    for (const row of rows) {
      if (!matchesPayload(row, args)) continue;
      return {
        matched: row,
        waited: Date.now() - (deadline - timeoutMs),
        checked,
      };
    }
    await sleep(pollMs);
  }

  return { matched: null, waited: timeoutMs, checked };
}

interface VerificationRow {
  id: string;
  ownerId: string;
  ownerType: "user" | "lead";
  actionKey: string;
  token: string;
  payload?: Record<string, unknown>;
  expiresAt: string;
  usedAt?: string;
  systemSlug?: string;
  createdAt: string;
}

interface VerificationFilters {
  actionKey?: string;
  ownerId?: string;
  token?: string;
  includeUsed?: boolean;
  limit?: number;
}

async function listVerificationRequests(
  filters: VerificationFilters,
): Promise<VerificationRow[]> {
  const db = await getDb();
  const limit = Math.max(1, Math.min(filters.limit ?? 20, 200));

  const bindings: Record<string, unknown> = {
    actionKey: filters.actionKey ?? undefined,
    verificationToken: filters.token ?? undefined,
    ownerId: filters.ownerId ? rid(filters.ownerId) : undefined,
    limit,
    includeUsed: Boolean(filters.includeUsed),
  };

  const result = await db.query<[VerificationRow[]]>(
    `SELECT id, ownerId, ownerType, actionKey, token, payload,
            expiresAt, usedAt, systemSlug, createdAt
     FROM verification_request
     WHERE ($actionKey = NONE OR actionKey = $actionKey)
       AND ($verificationToken = NONE OR token = $verificationToken)
       AND ($ownerId = NONE OR ownerId = $ownerId)
       AND ($includeUsed = true OR usedAt IS NONE)
     ORDER BY createdAt DESC
     LIMIT $limit`,
    bindings,
  );
  return result[0] ?? [];
}

interface WaitVerificationArgs extends VerificationFilters {
  timeoutMs?: number;
  pollMs?: number;
  since?: Date;
}

async function waitForVerification(
  args: WaitVerificationArgs,
): Promise<{ matched: VerificationRow | null; waited: number }> {
  const timeoutMs = args.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const pollMs = args.pollMs ?? DEFAULT_POLL_INTERVAL_MS;
  const since = args.since ?? new Date(Date.now() - 2 * 60 * 1000);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const rows = await listVerificationRequests({
      ...args,
      limit: args.limit ?? 50,
    });
    for (const row of rows) {
      if (new Date(row.createdAt) >= since) {
        return { matched: row, waited: Date.now() - (deadline - timeoutMs) };
      }
    }
    await sleep(pollMs);
  }
  return { matched: null, waited: timeoutMs };
}

async function getStats(sinceMinutes: number): Promise<{
  byStatus: Record<string, number>;
  byHandler: Record<
    string,
    { pending: number; processing: number; done: number; dead: number }
  >;
  total: number;
}> {
  const db = await getDb();
  const since = new Date(Date.now() - sinceMinutes * 60 * 1000);
  const result = await db.query<[
    { status: string; count: number }[],
    { handler: string; status: string; count: number }[],
  ]>(
    `SELECT status, count() AS count FROM delivery
       WHERE createdAt >= $since
       GROUP BY status;
     SELECT handler, status, count() AS count FROM delivery
       WHERE createdAt >= $since
       GROUP BY handler, status;`,
    { since },
  );
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const row of result[0] ?? []) {
    byStatus[row.status] = row.count;
    total += row.count;
  }
  const byHandler: Record<string, {
    pending: number;
    processing: number;
    done: number;
    dead: number;
  }> = {};
  for (const row of result[1] ?? []) {
    const bucket = byHandler[row.handler] ??
      { pending: 0, processing: 0, done: 0, dead: 0 };
    (bucket as Record<string, number>)[row.status] = row.count;
    byHandler[row.handler] = bucket;
  }
  return { byStatus, byHandler, total };
}

async function clearQueue(olderThanMinutes: number): Promise<{
  events: number;
  deliveries: number;
  verifications: number;
}> {
  const db = await getDb();
  const before = new Date(Date.now() - olderThanMinutes * 60 * 1000);
  const result = await db.query<[
    { before: unknown[] }[],
    unknown[],
    unknown[],
    unknown[],
  ]>(
    `LET $delBefore = (SELECT id FROM delivery WHERE createdAt < $before);
     LET $evtBefore = (SELECT id FROM queue_event WHERE createdAt < $before);
     LET $vrBefore = (SELECT id FROM verification_request WHERE createdAt < $before);
     [{
       deliveries: array::len($delBefore),
       events: array::len($evtBefore),
       verifications: array::len($vrBefore)
     }];
     DELETE delivery WHERE createdAt < $before;
     DELETE queue_event WHERE createdAt < $before;
     DELETE verification_request WHERE createdAt < $before;`,
    { before },
  );
  const counts = (result[3] as unknown as {
    deliveries: number;
    events: number;
    verifications: number;
  }[] | undefined)?.[0] ?? {
    deliveries: 0,
    events: 0,
    verifications: 0,
  };
  return counts;
}

// ---------------------------------------------------------------------------
// Helpers for payload extraction. The most common thing callers want to do
// is: "give me the confirmation link from the notification that was just
// published to this recipient". Surface those as dedicated verbs so the
// caller never has to write jq.
// ---------------------------------------------------------------------------

function extractConfirmationLink(row: DeliveryRow | null): string | null {
  if (!row) return null;
  const td =
    (row.payload?.templateData as Record<string, unknown> | undefined) ??
      {};
  const link = td.confirmationLink;
  return typeof link === "string" ? link : null;
}

function extractTemplateData(
  row: DeliveryRow | null,
): Record<string, unknown> | null {
  if (!row) return null;
  const td = row.payload?.templateData;
  return td && typeof td === "object" ? td as Record<string, unknown> : null;
}

// Turn a verification_request row into the confirmation URL the user would
// click in their email — composed from `app.baseUrl` + `/verify?token=<token>`.
async function buildVerificationLink(
  row: VerificationRow | null,
): Promise<string | null> {
  if (!row) return null;
  const db = await getDb();
  const slug = row.systemSlug ?? "core";
  // `value` is a reserved SurrealQL identifier — wrap in backticks to select
  // the column of that name. We batch both the system-specific lookup and
  // the core-level fallback in a single db.query() per §7.2.
  const res = await db.query<[
    { v: string }[],
    { v: string }[],
  ]>(
    "SELECT `value` AS v FROM setting " +
      'WHERE key = "app.baseUrl" AND systemSlug = $slug LIMIT 1;' +
      " SELECT `value` AS v FROM setting " +
      'WHERE key = "app.baseUrl" AND systemSlug = "core" LIMIT 1;',
    { slug },
  );
  const baseUrl = res[0]?.[0]?.v ?? res[1]?.[0]?.v ?? "http://localhost:3000";
  return `${baseUrl.replace(/\/$/, "")}/verify?token=${row.token}`;
}

// ---------------------------------------------------------------------------
// Frontend delegation — when the caller asks us to "click" a confirmation
// link, hand off to the test-frontend skill which already owns a real
// browser. This keeps test-events single-responsibility: it inspects the
// queue, test-frontend drives the UI.
// ---------------------------------------------------------------------------

async function confirmViaFrontend(
  url: string,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const tsxBin = resolve(PROJECT_ROOT, "node_modules", ".bin", "tsx");
  const runScript = resolve(PROJECT_ROOT, "skills", "test-frontend", "run.ts");
  if (!existsSync(tsxBin)) {
    throw new Error(
      "`tsx` is not installed in the project. Run `npm install` in the project root.",
    );
  }
  if (!existsSync(runScript)) {
    throw new Error(`test-frontend skill not found at ${runScript}`);
  }
  const result = spawnSync(
    tsxBin,
    [runScript, "goto", url],
    { cwd: PROJECT_ROOT, encoding: "utf-8" },
  );
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

type ParsedArgs = {
  positional: string[];
  flags: Record<string, string | boolean | string[]>;
};

function parseArgs(input: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: ParsedArgs["flags"] = {};
  for (let i = 0; i < input.length; i++) {
    const a = input[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = input[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        const prior = flags[key];
        if (prior === undefined) flags[key] = next;
        else if (Array.isArray(prior)) prior.push(next);
        else flags[key] = [String(prior), next];
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function parseSince(value: unknown): Date | undefined {
  if (value === undefined || value === true) return undefined;
  const raw = String(value);
  // ISO timestamp passthrough.
  if (/\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  // Relative duration (e.g. "30s", "5m", "1h").
  const m = raw.match(/^(\d+)\s*([smh])?$/);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2] ?? "m";
    const ms = unit === "s"
      ? n * 1000
      : unit === "h"
      ? n * 3_600_000
      : n * 60_000;
    return new Date(Date.now() - ms);
  }
  throw new Error(
    `cannot parse --since "${raw}" (use ISO timestamp or Ns/Nm/Nh)`,
  );
}

function printHelp(): void {
  console.log(
    [
      "test-events — debug/verify any handler in the project's event queue (communications are one case among many).",
      "",
      "USAGE",
      "  tsx skills/test-events/run.ts <command> [args]",
      "",
      "LIST / INSPECT",
      "  list                                  list recent deliveries (default: last 5 minutes)",
      "    [--handler NAME]                      e.g. send_email, send_communication",
      "    [--status pending|processing|done|dead]",
      "    [--event-name NAME]                   the underlying queue_event name",
      "    [--since <iso|30s|5m|1h>]             lower time bound (default: 5m ago)",
      "    [--limit N]                           default 50, cap 500",
      "    [--compact]                           single-line JSON",
      "",
      "  stats [--minutes N]                   bucket recent deliveries by status + handler",
      "",
      "WAIT",
      "  wait                                  block until a delivery matches, then print it",
      "    [--handler NAME]                    (most common gate)",
      "    [--event-name NAME]",
      "    [--recipient user:...|lead:...]     match payload.recipients contains this id",
      "    [--action-key auth.action.register] match templateData.actionKey",
      "    [--status pending|processing|done]  default: any status",
      "    [--payload-contains '{json}']       deep match against payload; strings match by",
      "                                         substring OR equality",
      "    [--since <dur>]                     lower time bound (default 2m ago)",
      "    [--timeout <ms>]                    default 60000",
      "    [--poll <ms>]                       default 500",
      "",
      "VERIFICATION",
      "  verification list                     list recent verification_request rows",
      "    [--action-key auth.action.register] [--owner-id user:...]",
      "    [--token <str>] [--include-used]",
      "    [--limit N]",
      "",
      "  verification wait                     block until a verification_request matches",
      "    (same filters as `list`)",
      "    [--timeout <ms>] [--poll <ms>] [--since <dur>]",
      "",
      "  verification link                     resolve & print the confirmation URL",
      "    [--action-key ...] [--owner-id ...] [--token ...]",
      "                                         (wraps `verification list --limit 1`)",
      "",
      "  verification confirm                  wait for a verification → resolve its link →",
      "                                         drive /verify in a real browser via the",
      "                                         test-frontend skill → print the result",
      "    [--action-key ...] [--owner-id ...] [--timeout ...]",
      "",
      "UTILITY",
      "  clear [--older-than-minutes N]        delete old queue_event / delivery /",
      "                                         verification_request rows (default: 60)",
      "",
      "  confirm-link <url>                    open an arbitrary confirmation URL via the",
      "                                         test-frontend skill (useful when you already",
      "                                         have the link)",
      "",
      "OUTPUT",
      "  JSON on stdout; errors on stderr prefixed with [test-events]; non-zero exit on error.",
      '  Record ids are flattened to "table:id" strings.',
      "",
      "RULES",
      '  - database.json must carry `"test": true` (refuses otherwise).',
      "  - Uses node:* specifiers so the shape is runtime-agnostic — same style Deno accepts.",
      "  - The first call auto-starts the dev server (via test-routes) if nothing is running,",
      "    because event handlers only execute while the worker loop is up.",
      "  - When no dependencies are needed beyond the project's own, nothing is installed.",
    ].join("\n"),
  );
}

async function runCli(argv: string[]): Promise<number> {
  if (
    argv.length === 0 || argv[0] === "help" || argv[0] === "-h" ||
    argv[0] === "--help"
  ) {
    printHelp();
    return 0;
  }

  await ensureDatabaseReady();

  const cmd = argv[0];
  const rest = argv.slice(1);
  const { positional, flags } = parseArgs(rest);
  const pretty = flags.compact !== true;

  switch (cmd) {
    case "list": {
      const rows = await listDeliveries({
        handler: typeof flags.handler === "string" ? flags.handler : undefined,
        status: typeof flags.status === "string" ? flags.status : undefined,
        eventName: typeof flags["event-name"] === "string"
          ? (flags["event-name"] as string)
          : undefined,
        since: parseSince(flags.since),
        limit: typeof flags.limit === "string"
          ? Number(flags.limit)
          : undefined,
      });
      console.log(
        stringify({ ok: true, count: rows.length, deliveries: rows }, pretty),
      );
      return 0;
    }

    case "wait": {
      // The worker loop only runs while the dev server is up — so make sure
      // one is reachable before blocking.
      await ensureWorkerRunning(180_000);

      let payloadContains: Record<string, unknown> | undefined;
      if (typeof flags["payload-contains"] === "string") {
        try {
          payloadContains = JSON.parse(flags["payload-contains"] as string);
        } catch (err) {
          console.error(
            `[test-events] --payload-contains must be valid JSON: ${
              (err as Error).message
            }`,
          );
          return 1;
        }
      }

      const { matched, waited, checked } = await waitForDelivery({
        handler: typeof flags.handler === "string" ? flags.handler : undefined,
        status: typeof flags.status === "string"
          ? (flags.status as "pending" | "processing" | "done" | "dead")
          : undefined,
        eventName: typeof flags["event-name"] === "string"
          ? (flags["event-name"] as string)
          : undefined,
        recipient: typeof flags.recipient === "string"
          ? flags.recipient
          : undefined,
        actionKey: typeof flags["action-key"] === "string"
          ? (flags["action-key"] as string)
          : undefined,
        payloadContains,
        since: parseSince(flags.since),
        timeoutMs: typeof flags.timeout === "string"
          ? Number(flags.timeout)
          : undefined,
        pollMs: typeof flags.poll === "string" ? Number(flags.poll) : undefined,
        limit: typeof flags.limit === "string"
          ? Number(flags.limit)
          : undefined,
      });

      if (!matched) {
        console.error(
          `[test-events] no matching delivery after ${waited}ms (checked ${checked} rows on last pass)`,
        );
        console.log(stringify({ ok: false, matched: null, waited }, pretty));
        return 1;
      }

      console.log(
        stringify(
          {
            ok: true,
            matched,
            confirmationLink: extractConfirmationLink(matched),
            templateData: extractTemplateData(matched),
            waitedMs: waited,
          },
          pretty,
        ),
      );
      return 0;
    }

    case "stats": {
      const minutes = typeof flags.minutes === "string"
        ? Number(flags.minutes)
        : 15;
      const stats = await getStats(minutes);
      console.log(
        stringify({ ok: true, sinceMinutes: minutes, ...stats }, pretty),
      );
      return 0;
    }

    case "clear": {
      const minutes = typeof flags["older-than-minutes"] === "string"
        ? Number(flags["older-than-minutes"])
        : 60;
      const counts = await clearQueue(minutes);
      console.log(
        stringify(
          { ok: true, olderThanMinutes: minutes, deleted: counts },
          pretty,
        ),
      );
      return 0;
    }

    case "verification": {
      const sub = positional[0];
      const subFlagsInput = positional.slice(1);
      // Re-parse to pick up flags that appeared after the subcommand.
      const filters = {
        actionKey: typeof flags["action-key"] === "string"
          ? (flags["action-key"] as string)
          : undefined,
        ownerId: typeof flags["owner-id"] === "string"
          ? (flags["owner-id"] as string)
          : undefined,
        token: typeof flags.token === "string"
          ? (flags.token as string)
          : undefined,
        includeUsed: flags["include-used"] === true,
        limit: typeof flags.limit === "string"
          ? Number(flags.limit)
          : undefined,
      };

      if (sub === "list") {
        const rows = await listVerificationRequests(filters);
        console.log(stringify({ ok: true, count: rows.length, rows }, pretty));
        return 0;
      }

      if (sub === "wait") {
        const { matched, waited } = await waitForVerification({
          ...filters,
          timeoutMs: typeof flags.timeout === "string"
            ? Number(flags.timeout)
            : undefined,
          pollMs: typeof flags.poll === "string"
            ? Number(flags.poll)
            : undefined,
          since: parseSince(flags.since),
        });
        if (!matched) {
          console.error(
            `[test-events] no verification_request matched after ${waited}ms`,
          );
          console.log(stringify({ ok: false, matched: null, waited }, pretty));
          return 1;
        }
        const link = await buildVerificationLink(matched);
        console.log(
          stringify({
            ok: true,
            matched,
            confirmationLink: link,
            waitedMs: waited,
          }, pretty),
        );
        return 0;
      }

      if (sub === "link") {
        filters.limit = 1;
        const rows = await listVerificationRequests(filters);
        const row = rows[0] ?? null;
        if (!row) {
          console.error("[test-events] no verification_request matched");
          console.log(stringify({ ok: false, row: null }, pretty));
          return 1;
        }
        const link = await buildVerificationLink(row);
        console.log(
          stringify({ ok: true, confirmationLink: link, row }, pretty),
        );
        return 0;
      }

      if (sub === "confirm") {
        await ensureWorkerRunning(180_000);
        const { matched, waited } = await waitForVerification({
          ...filters,
          timeoutMs: typeof flags.timeout === "string"
            ? Number(flags.timeout)
            : undefined,
          pollMs: typeof flags.poll === "string"
            ? Number(flags.poll)
            : undefined,
          since: parseSince(flags.since),
        });
        if (!matched) {
          console.error(
            `[test-events] no verification_request matched after ${waited}ms`,
          );
          return 1;
        }
        const link = await buildVerificationLink(matched);
        if (!link) {
          console.error("[test-events] could not resolve confirmation link");
          return 1;
        }
        const res = await confirmViaFrontend(link);
        console.log(
          stringify(
            {
              ok: res.ok,
              confirmationLink: link,
              row: matched,
              frontend: { stdout: res.stdout, stderr: res.stderr },
            },
            pretty,
          ),
        );
        return res.ok ? 0 : 1;
      }

      console.error(
        `[test-events] unknown verification subcommand: ${
          sub ?? ""
        }. Try: list | wait | link | confirm`,
      );
      printHelp();
      return 1;
    }

    case "confirm-link": {
      const url = positional[0];
      if (!url) {
        console.error("[test-events] usage: confirm-link <url>");
        return 1;
      }
      const res = await confirmViaFrontend(url);
      console.log(
        stringify(
          {
            ok: res.ok,
            url,
            frontend: { stdout: res.stdout, stderr: res.stderr },
          },
          pretty,
        ),
      );
      return res.ok ? 0 : 1;
    }

    default:
      console.error(`[test-events] unknown command: ${cmd}`);
      printHelp();
      return 1;
  }
}

try {
  const code = await runCli(process.argv.slice(2));
  await closeDb().catch(() => {});
  process.exit(code);
} catch (err) {
  console.error("[test-events] fatal:", (err as Error).stack ?? err);
  await closeDb().catch(() => {});
  process.exit(1);
}
