import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { randomBytes } from "node:crypto";
import dbConfig from "../../database.json" with { type: "json" };

/**
 * Test-mode guard.
 *
 * Hard-refuses to run when `database.json` does not carry `"test": true`.
 * Deterministic: no env var override, no flag. This skill hits real routes
 * and mutates real data — it only runs against a database explicitly marked
 * as a test target.
 */
const isTestMode = (dbConfig as { test?: unknown }).test === true;
if (!isTestMode) {
  console.error(
    [
      "[test-routes] REFUSING TO RUN.",
      "",
      'database.json does not have `"test": true`.',
      "",
      "This skill exercises real API routes against the configured database.",
      "It only runs against a database that has been explicitly marked as a",
      "test target. To proceed:",
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
const SKILL_DIR = resolve(PROJECT_ROOT, "skills", "test-routes");
const PID_FILE = resolve(SKILL_DIR, ".server.pid");
const PORT_FILE = resolve(SKILL_DIR, ".server.port");
const LOG_FILE = resolve(SKILL_DIR, ".server.log");
const TOKEN_FILE = resolve(SKILL_DIR, ".superuser-token");

// Default superuser credentials from 001_superuser.ts seed.
const DEFAULT_SUPERUSER_EMAIL = "core@admin.com";
const DEFAULT_SUPERUSER_PASSWORD = "core1234";

const DEFAULT_PORT = Number(process.env.PORT ?? 3000);

function ensureSkillDir(): void {
  if (!existsSync(SKILL_DIR)) mkdirSync(SKILL_DIR, { recursive: true });
}

function readPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  const raw = readFileSync(PID_FILE, "utf-8").trim();
  const pid = Number(raw);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

function readPort(): number {
  if (!existsSync(PORT_FILE)) return DEFAULT_PORT;
  const raw = readFileSync(PORT_FILE, "utf-8").trim();
  const port = Number(raw);
  return Number.isFinite(port) && port > 0 ? port : DEFAULT_PORT;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getBaseUrl(): string {
  const port = readPort();
  return `http://localhost:${port}`;
}

async function pingServer(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/public/front-core`, {
      method: "GET",
    });
    // Any HTTP response means the server is up — even a 500.
    return res.status > 0;
  } catch {
    return false;
  }
}

async function waitForServer(
  baseUrl: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pingServer(baseUrl)) return true;
    await sleep(500);
  }
  return false;
}

interface StartServerOptions {
  port: number;
  timeoutMs: number;
  foreground: boolean;
}

async function cmdServerStart(opts: StartServerOptions): Promise<number> {
  ensureSkillDir();

  const existing = readPid();
  if (existing && isPidAlive(existing)) {
    const baseUrl = getBaseUrl();
    if (await pingServer(baseUrl)) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            alreadyRunning: true,
            pid: existing,
            baseUrl,
          },
          null,
          2,
        ),
      );
      return 0;
    }
  }

  writeFileSync(PORT_FILE, String(opts.port));
  writeFileSync(LOG_FILE, "");

  const env = { ...process.env, PORT: String(opts.port) };

  if (opts.foreground) {
    console.error(
      `[test-routes] starting dev server in foreground on port ${opts.port} (Ctrl-C to stop)`,
    );
    const child = spawn("npm", ["run", "dev"], {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
      env,
    });
    const code = await new Promise<number>((resolvePromise) => {
      child.on("exit", (c) => resolvePromise(c ?? 0));
    });
    return code;
  }

  // Detached background spawn. Redirect stdout/stderr to the log file via a
  // shell so the child survives after we exit. Using a shell keeps this
  // portable across npm wrappers on Linux/macOS and sidesteps needing to
  // manage file descriptors manually.
  const logPath = LOG_FILE.replace(/"/g, '\\"');
  const cmd = `npm run dev > "${logPath}" 2>&1`;
  const child = spawn(cmd, {
    cwd: PROJECT_ROOT,
    shell: true,
    detached: true,
    stdio: "ignore",
    env,
  });
  child.unref();

  if (!child.pid) {
    console.error("[test-routes] failed to spawn dev server");
    return 1;
  }

  writeFileSync(PID_FILE, String(child.pid));

  const baseUrl = `http://localhost:${opts.port}`;
  const ready = await waitForServer(baseUrl, opts.timeoutMs);
  if (!ready) {
    console.error(
      `[test-routes] server did not become ready within ${opts.timeoutMs}ms. See ${LOG_FILE}`,
    );
    return 1;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        started: true,
        pid: child.pid,
        baseUrl,
        logFile: LOG_FILE,
      },
      null,
      2,
    ),
  );
  return 0;
}

function killProcessTree(pid: number): void {
  // On POSIX, spawning via `shell: true` creates a shell process with the
  // `npm` child underneath. Sending a signal to the negative PID (process
  // group) terminates the whole subtree.
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // best-effort
    }
  }
}

async function cmdServerStop(): Promise<number> {
  const pid = readPid();
  if (!pid) {
    console.log(
      JSON.stringify({ ok: true, message: "no server pid recorded" }, null, 2),
    );
    return 0;
  }

  if (!isPidAlive(pid)) {
    if (existsSync(PID_FILE)) rmSync(PID_FILE);
    console.log(
      JSON.stringify({ ok: true, message: "server was not running" }, null, 2),
    );
    return 0;
  }

  killProcessTree(pid);

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && isPidAlive(pid)) {
    await sleep(200);
  }

  if (isPidAlive(pid)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // best-effort
      }
    }
  }

  if (existsSync(PID_FILE)) rmSync(PID_FILE);
  console.log(JSON.stringify({ ok: true, stopped: true, pid }, null, 2));
  return 0;
}

async function cmdServerStatus(): Promise<number> {
  const pid = readPid();
  const baseUrl = getBaseUrl();
  const alive = pid ? isPidAlive(pid) : false;
  const reachable = await pingServer(baseUrl);

  console.log(
    JSON.stringify(
      {
        ok: true,
        pid: pid ?? null,
        pidAlive: alive,
        baseUrl,
        reachable,
        logFile: existsSync(LOG_FILE) ? LOG_FILE : null,
      },
      null,
      2,
    ),
  );
  return reachable ? 0 : 1;
}

async function cmdServerLogs(tailLines: number): Promise<number> {
  if (!existsSync(LOG_FILE)) {
    console.log(JSON.stringify({ ok: true, log: "" }, null, 2));
    return 0;
  }
  const raw = readFileSync(LOG_FILE, "utf-8");
  const lines = raw.split("\n");
  const sliced = tailLines > 0 ? lines.slice(-tailLines) : lines;
  console.log(sliced.join("\n"));
  return 0;
}

interface LoginResult {
  token: string;
  user: unknown;
}

async function loginSuperuser(
  baseUrl: string,
  email: string,
  password: string,
): Promise<LoginResult> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      identifier: email,
      password,
      stayLoggedIn: false,
    }),
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(
      `login failed (status ${res.status}): ${
        typeof body === "string" ? body : JSON.stringify(body)
      }`,
    );
  }
  const data = (body as { success?: boolean; data?: Record<string, unknown> })
    ?.data;
  const token = data?.systemToken as string | undefined;
  if (!token) {
    throw new Error(
      `login response missing data.systemToken: ${JSON.stringify(body)}`,
    );
  }
  return { token, user: data?.user };
}

async function cmdLogin(
  email: string,
  password: string,
  persist: boolean,
): Promise<number> {
  ensureSkillDir();
  const baseUrl = getBaseUrl();
  const reachable = await pingServer(baseUrl);
  if (!reachable) {
    console.error(
      `[test-routes] server is not reachable at ${baseUrl}. Start it with: tsx skills/test-routes/run.ts server start`,
    );
    return 1;
  }

  try {
    const result = await loginSuperuser(baseUrl, email, password);
    if (persist) writeFileSync(TOKEN_FILE, result.token);
    console.log(
      JSON.stringify(
        {
          ok: true,
          token: result.token,
          user: result.user,
          baseUrl,
          persistedTo: persist ? TOKEN_FILE : null,
        },
        null,
        2,
      ),
    );
    return 0;
  } catch (err) {
    console.error(`[test-routes] ${(err as Error).message}`);
    return 1;
  }
}

function readCachedToken(): string | null {
  if (!existsSync(TOKEN_FILE)) return null;
  const raw = readFileSync(TOKEN_FILE, "utf-8").trim();
  return raw || null;
}

interface FormField {
  key: string;
  value: string;
}

interface FormFile {
  key: string;
  fileName: string;
  data: Uint8Array;
}

interface RequestFlags {
  method: string;
  path: string;
  body?: string;
  headers: Record<string, string>;
  token?: string;
  asSuperuser: boolean;
  superuserEmail: string;
  superuserPassword: string;
  baseUrl: string;
  raw: boolean;
  compact: boolean;
  includeResponseHeaders: boolean;
  followRedirects: boolean;
  formFields: FormField[];
  formFiles: FormFile[];
}

function prettyBody(text: string, contentType: string): unknown {
  if (!text) return "";
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  // Try JSON anyway — many handlers use Response.json()
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function cmdRequest(flags: RequestFlags): Promise<number> {
  const baseUrl = flags.baseUrl.replace(/\/$/, "");

  let token = flags.token ?? null;
  if (!token && flags.asSuperuser) {
    // Prefer a cached token to avoid re-logging in; fall back to login.
    const cached = readCachedToken();
    if (cached) {
      token = cached;
    } else {
      try {
        const login = await loginSuperuser(
          baseUrl,
          flags.superuserEmail,
          flags.superuserPassword,
        );
        token = login.token;
        writeFileSync(TOKEN_FILE, token);
      } catch (err) {
        console.error(`[test-routes] ${(err as Error).message}`);
        return 1;
      }
    }
  }

  const headers: Record<string, string> = { ...flags.headers };
  if (token) headers["authorization"] = `Bearer ${token}`;

  const init: RequestInit = {
    method: flags.method,
    headers,
    redirect: flags.followRedirects ? "follow" : "manual",
  };

  const hasForm = flags.formFields.length > 0 || flags.formFiles.length > 0;

  if (hasForm) {
    const fd = new FormData();
    for (const f of flags.formFields) fd.append(f.key, f.value);
    for (const f of flags.formFiles) {
      fd.append(
        f.key,
        new Blob([new Uint8Array(f.data)], {
          type: "application/octet-stream",
        }),
        f.fileName,
      );
    }
    init.body = fd;
    // Let fetch set Content-Type with boundary automatically.
    delete headers["content-type"];
  } else if (flags.body !== undefined && flags.body !== null) {
    init.body = flags.body;
    if (!Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
      headers["content-type"] = "application/json";
    }
  }

  const url = flags.path.startsWith("http")
    ? flags.path
    : `${baseUrl}${flags.path.startsWith("/") ? "" : "/"}${flags.path}`;

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    console.error(`[test-routes] fetch failed: ${(err as Error).message}`);
    console.error(
      `[test-routes] is the server running? Try: tsx skills/test-routes/run.ts server status`,
    );
    return 1;
  }

  const resText = await res.text();
  const contentType = res.headers.get("content-type") ?? "";

  // 401 + --as-superuser → the cached token likely expired. Re-login once.
  if (
    res.status === 401 && flags.asSuperuser && !flags.token &&
    readCachedToken()
  ) {
    try {
      const login = await loginSuperuser(
        baseUrl,
        flags.superuserEmail,
        flags.superuserPassword,
      );
      writeFileSync(TOKEN_FILE, login.token);
      headers["authorization"] = `Bearer ${login.token}`;
      const retry = await fetch(url, {
        ...init,
        headers,
      });
      const retryText = await retry.text();
      const retryCT = retry.headers.get("content-type") ?? "";
      return emit(retry, retryText, retryCT, flags);
    } catch {
      // fall through — return the original 401 so the caller sees it
    }
  }

  return emit(res, resText, contentType, flags);
}

function emit(
  res: Response,
  text: string,
  contentType: string,
  flags: RequestFlags,
): number {
  if (flags.raw) {
    // Just the body as received
    process.stdout.write(text);
    if (!text.endsWith("\n")) process.stdout.write("\n");
    return res.ok ? 0 : 1;
  }

  const body = prettyBody(text, contentType);
  const result: Record<string, unknown> = {
    status: res.status,
    statusText: res.statusText,
    ok: res.ok,
    url: res.url,
    body,
  };
  if (flags.includeResponseHeaders) {
    const hdrs: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      hdrs[k] = v;
    });
    result.headers = hdrs;
  }

  console.log(
    flags.compact ? JSON.stringify(result) : JSON.stringify(result, null, 2),
  );
  return res.ok ? 0 : 1;
}

function parseHeader(arg: string): [string, string] | null {
  const idx = arg.indexOf(":");
  if (idx <= 0) return null;
  const k = arg.slice(0, idx).trim();
  const v = arg.slice(idx + 1).trim();
  if (!k) return null;
  return [k, v];
}

function printHelp(): void {
  console.log(
    [
      "test-routes — exercise the project's API routes against the configured test DB.",
      "",
      "USAGE",
      "  tsx skills/test-routes/run.ts <command> [args]",
      "",
      "COMMANDS",
      "  request <METHOD> <PATH> [BODY-JSON]   (default if no command given)",
      "  server start [--port N] [--timeout N] [--foreground]",
      "  server stop",
      "  server status",
      "  server logs [--tail N]",
      "  login [--email X] [--password Y] [--no-persist]",
      "  help",
      "",
      "REQUEST OPTIONS",
      "  --body <json>                JSON body (preferred over positional).",
      "  --body-file <path>           Read body from a file.",
      "  -H, --header 'Key: Value'    Add request header (repeatable).",
      "  --as-superuser               Login as seeded superuser (core@admin.com)",
      "                               and attach Authorization: Bearer <token>.",
      "                               Token is cached in skills/test-routes/.superuser-token.",
      "  --token <jwt>                Attach a specific bearer token.",
      "  --base-url <url>             Override base URL (default: reads port file or localhost:3000).",
      "  --include-response-headers   Include response headers in JSON output.",
      "  --raw                        Print body as-is (no wrapping JSON).",
      "  --compact                    One-line JSON output.",
      "  --follow-redirects           Follow 3xx responses.",
      "",
      "FORM / FILE UPLOAD OPTIONS",
      "  --form key=value             Add a text field to a multipart/form-data request.",
      "                               Repeatable. When any --form or --form-file is present,",
      "                               the body is sent as FormData instead of JSON.",
      "  --form-file filename.ext     Attach a generated file with random data.",
      '                               Always uses form key "file". Repeatable.',
      "                               The file content is random bytes generated in memory.",
      "                               Use --file-size to control size.",
      "  --form-real-file path        Attach an existing file from disk.",
      '                               Always uses form key "file". Repeatable.',
      "  --file-size <N>              Size in bytes for --form-file (default: 1024).",
      "                               Suffix: K=KB, M=MB (e.g. 512K, 2M).",
      "",
      "SERVER OPTIONS",
      "  --port <N>                   Port to bind (default: 3000).",
      "  --timeout <ms>               Readiness timeout for start (default: 120000).",
      "  --foreground                 Run in foreground (blocks; Ctrl-C to stop).",
      "",
      "LOGIN OPTIONS",
      "  --email <addr>               Default: core@admin.com (from 001_superuser.ts seed).",
      "  --password <pwd>             Default: core1234 (from 001_superuser.ts seed).",
      "  --no-persist                 Do not cache the token to .superuser-token.",
      "",
      "EXAMPLES",
      "  # Typical session",
      "  tsx skills/test-routes/run.ts server start",
      "  tsx skills/test-routes/run.ts login",
      "  tsx skills/test-routes/run.ts GET /api/public/front-core",
      "  tsx skills/test-routes/run.ts GET /api/core/systems --as-superuser",
      "  tsx skills/test-routes/run.ts POST /api/core/systems \\",
      '      --body \'{"name":"Foo","slug":"foo"}\' --as-superuser',
      "  tsx skills/test-routes/run.ts server stop",
      "",
      "  # Inline body as a positional argument (convenient for one-liners)",
      '  tsx skills/test-routes/run.ts POST /api/auth/login \'{"identifier":"core@admin.com","password":"core1234"}\'',
      "",
      "  # Form submission with text fields",
      "  tsx skills/test-routes/run.ts POST /api/some-form \\",
      '      --form "name=Alice" --form "email=alice@test.com" --as-superuser',
      "",
      "  # File upload with generated random file",
      "  tsx skills/test-routes/run.ts POST /api/files/upload \\",
      '      --form "systemSlug=grex-id" \\',
      '      --form "category=[\\"avatars\\"]" \\',
      '      --form "fileUuid=$(uuidgen)" \\',
      "      --form-file photo.png --as-superuser",
      "",
      "  # Upload with a 2MB random file",
      "  tsx skills/test-routes/run.ts POST /api/files/upload \\",
      '      --form "systemSlug=grex-id" --form "category=[\\"docs\\"]" \\',
      '      --form "fileUuid=$(uuidgen)" --form-file report.pdf \\',
      "      --file-size 2M --as-superuser",
      "",
      "  # Upload a real file from disk",
      "  tsx skills/test-routes/run.ts POST /api/files/upload \\",
      '      --form "systemSlug=grex-id" --form "category=[\\"docs\\"]" \\',
      '      --form "fileUuid=$(uuidgen)" --form-real-file /tmp/data.csv \\',
      "      --as-superuser",
      "",
      "RULES",
      '  - database.json must carry `"test": true` (refuses otherwise).',
      "  - The server must be running before request/login commands. Use `server start`.",
      "  - Uses node:* specifiers (node:fs, node:path, node:child_process) so the",
      "    runtime-agnostic shape matches Deno's import style.",
    ].join("\n"),
  );
}

function parseArgs(argv: string[]): Promise<number> {
  const args = argv.slice();

  // Extract subcommand. If the first token looks like an HTTP method, treat
  // the whole invocation as an implicit `request ...` for convenience.
  if (args.length === 0) {
    printHelp();
    return Promise.resolve(0);
  }

  const first = args[0].toUpperCase();
  const HTTP_METHODS = [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS",
    "HEAD",
  ];
  if (HTTP_METHODS.includes(first)) {
    return handleRequest(args);
  }

  const cmd = args.shift()!;
  switch (cmd) {
    case "help":
    case "-h":
    case "--help":
      printHelp();
      return Promise.resolve(0);

    case "server":
      return handleServer(args);

    case "login":
      return handleLogin(args);

    case "request":
      return handleRequest(args);

    default:
      console.error(`[test-routes] unknown command: ${cmd}`);
      printHelp();
      return Promise.resolve(1);
  }
}

async function handleServer(args: string[]): Promise<number> {
  const sub = args.shift();
  switch (sub) {
    case "start": {
      let port = DEFAULT_PORT;
      let timeoutMs = 120_000;
      let foreground = false;
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "--port") port = Number(args[++i]);
        else if (a === "--timeout") timeoutMs = Number(args[++i]);
        else if (a === "--foreground") foreground = true;
        else {
          console.error(`[test-routes] unknown flag for server start: ${a}`);
          return 1;
        }
      }
      return cmdServerStart({ port, timeoutMs, foreground });
    }
    case "stop":
      return cmdServerStop();
    case "status":
      return cmdServerStatus();
    case "logs": {
      let tailLines = 50;
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "--tail") tailLines = Number(args[++i]);
        else if (a === "--all") tailLines = 0;
        else {
          console.error(`[test-routes] unknown flag for server logs: ${a}`);
          return 1;
        }
      }
      return cmdServerLogs(tailLines);
    }
    default:
      console.error(
        `[test-routes] server subcommand required: start | stop | status | logs`,
      );
      return 1;
  }
}

async function handleLogin(args: string[]): Promise<number> {
  let email = DEFAULT_SUPERUSER_EMAIL;
  let password = DEFAULT_SUPERUSER_PASSWORD;
  let persist = true;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--email") email = args[++i];
    else if (a === "--password") password = args[++i];
    else if (a === "--no-persist") persist = false;
    else {
      console.error(`[test-routes] unknown flag for login: ${a}`);
      return 1;
    }
  }
  return cmdLogin(email, password, persist);
}

function parseFileSize(raw: string): number {
  const upper = raw.toUpperCase();
  if (upper.endsWith("M")) return Math.floor(parseFloat(upper) * 1024 * 1024);
  if (upper.endsWith("K")) return Math.floor(parseFloat(upper) * 1024);
  return Math.floor(Number(raw));
}

async function handleRequest(args: string[]): Promise<number> {
  const flags: RequestFlags = {
    method: "GET",
    path: "",
    headers: {},
    asSuperuser: false,
    superuserEmail: DEFAULT_SUPERUSER_EMAIL,
    superuserPassword: DEFAULT_SUPERUSER_PASSWORD,
    baseUrl: getBaseUrl(),
    raw: false,
    compact: false,
    includeResponseHeaders: false,
    followRedirects: false,
    formFields: [],
    formFiles: [],
  };

  let fileSize = 1024;
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case "--body":
      case "-b":
        flags.body = args[++i];
        break;
      case "--body-file":
        flags.body = readFileSync(resolve(process.cwd(), args[++i]), "utf-8");
        break;
      case "-H":
      case "--header": {
        const parsed = parseHeader(args[++i]);
        if (!parsed) {
          console.error(`[test-routes] invalid header (expected 'Key: Value')`);
          return 1;
        }
        flags.headers[parsed[0]] = parsed[1];
        break;
      }
      case "--token":
        flags.token = args[++i];
        break;
      case "--as-superuser":
        flags.asSuperuser = true;
        break;
      case "--superuser-email":
        flags.superuserEmail = args[++i];
        break;
      case "--superuser-password":
        flags.superuserPassword = args[++i];
        break;
      case "--base-url":
        flags.baseUrl = args[++i];
        break;
      case "--raw":
        flags.raw = true;
        break;
      case "--compact":
        flags.compact = true;
        break;
      case "--include-response-headers":
        flags.includeResponseHeaders = true;
        break;
      case "--follow-redirects":
        flags.followRedirects = true;
        break;
      case "--form": {
        const fv = args[++i];
        const eqIdx = fv.indexOf("=");
        if (eqIdx <= 0) {
          console.error(
            `[test-routes] --form requires key=value format, got: ${fv}`,
          );
          return 1;
        }
        flags.formFields.push({
          key: fv.slice(0, eqIdx),
          value: fv.slice(eqIdx + 1),
        });
        break;
      }
      case "--form-file": {
        const fileName = args[++i];
        flags.formFiles.push({
          key: "file",
          fileName,
          data: randomBytes(fileSize),
        });
        break;
      }
      case "--form-real-file": {
        const filePath = resolve(process.cwd(), args[++i]);
        const fileName = filePath.split("/").pop() ?? "file";
        if (!existsSync(filePath)) {
          console.error(`[test-routes] file not found: ${filePath}`);
          return 1;
        }
        flags.formFiles.push({
          key: "file",
          fileName,
          data: new Uint8Array(readFileSync(filePath)),
        });
        break;
      }
      case "--file-size":
        fileSize = parseFileSize(args[++i]);
        break;
      default:
        positionals.push(a);
    }
  }

  if (positionals.length < 2) {
    console.error(
      `[test-routes] request requires <METHOD> <PATH>. Example: request GET /api/public/front-core`,
    );
    return 1;
  }

  flags.method = positionals[0].toUpperCase();
  flags.path = positionals[1];
  if (positionals[2] && flags.body === undefined) {
    flags.body = positionals[2];
  }

  return cmdRequest(flags);
}

parseArgs(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("[test-routes] fatal:", (err as Error).stack ?? err);
    process.exit(1);
  });
