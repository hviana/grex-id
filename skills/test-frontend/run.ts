import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import dbConfig from "../../database.json" with { type: "json" };

/**
 * Test-mode guard.
 *
 * Hard-refuses to run when `database.json` does not carry `"test": true`.
 * Deterministic: no env var override, no flag. This skill drives a real
 * browser against the project's dev server, which mutates real data — it
 * only runs against a database explicitly marked as a test target.
 */
const isTestMode = (dbConfig as { test?: unknown }).test === true;
if (!isTestMode) {
  console.error(
    [
      "[test-frontend] REFUSING TO RUN.",
      "",
      'database.json does not have `"test": true`.',
      "",
      "This skill drives a real browser against the configured database.",
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
const SKILL_DIR = resolve(PROJECT_ROOT, "skills", "test-frontend");
const DRIVER_PID_FILE = resolve(SKILL_DIR, ".driver.pid");
const DRIVER_PORT_FILE = resolve(SKILL_DIR, ".driver.port");
const DRIVER_LOG_FILE = resolve(SKILL_DIR, ".driver.log");
const SERVER_PID_FILE = resolve(SKILL_DIR, ".server.pid");
const SERVER_PORT_FILE = resolve(SKILL_DIR, ".server.port");
const SERVER_LOG_FILE = resolve(SKILL_DIR, ".server.log");
const SCREENSHOT_DIR = resolve(SKILL_DIR, "screenshots");
const STATE_FILE = resolve(SKILL_DIR, ".driver.state.json");

// Seeded superuser credentials from server/db/seeds/001_superuser.ts.
const DEFAULT_SUPERUSER_EMAIL = "core@admin.com";
const DEFAULT_SUPERUSER_PASSWORD = "core1234";

const DEFAULT_DEV_PORT = Number(process.env.PORT ?? 3000);
const DEFAULT_ACTION_TIMEOUT_MS = 30_000;
const DEFAULT_NAV_TIMEOUT_MS = 60_000;

function ensureSkillDir(): void {
  if (!existsSync(SKILL_DIR)) mkdirSync(SKILL_DIR, { recursive: true });
}

function readPid(file: string): number | null {
  if (!existsSync(file)) return null;
  const raw = readFileSync(file, "utf-8").trim();
  const pid = Number(raw);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

function readNumber(file: string, fallback: number): number {
  if (!existsSync(file)) return fallback;
  const raw = readFileSync(file, "utf-8").trim();
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killProcessTree(pid: number): void {
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

async function waitForProcessExit(
  pid: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && isPidAlive(pid)) {
    await sleep(150);
  }
  return !isPidAlive(pid);
}

// ---------------------------------------------------------------------------
// Dev server (Next.js) lifecycle — keep independent of the driver so the
// server can outlive individual driver sessions and can also be reused from
// the test-routes skill when the user starts the server there first.
// ---------------------------------------------------------------------------

async function pingDevServer(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/public/front-core`, {
      method: "GET",
    });
    return res.status > 0;
  } catch {
    return false;
  }
}

function getDevBaseUrl(): string {
  // Prefer a port file written by this skill; fall back to the test-routes
  // skill's port file so both skills can share a single dev server instance.
  const ownPort = existsSync(SERVER_PORT_FILE)
    ? readNumber(SERVER_PORT_FILE, 0)
    : 0;
  if (ownPort > 0) return `http://localhost:${ownPort}`;
  const routesPortFile = resolve(
    PROJECT_ROOT,
    "skills",
    "test-routes",
    ".server.port",
  );
  const sharedPort = existsSync(routesPortFile)
    ? readNumber(routesPortFile, 0)
    : 0;
  if (sharedPort > 0) return `http://localhost:${sharedPort}`;
  return `http://localhost:${DEFAULT_DEV_PORT}`;
}

async function ensureDevServer(
  port: number,
  timeoutMs: number,
): Promise<{ baseUrl: string; reusedExternal: boolean }> {
  ensureSkillDir();
  const explicit = `http://localhost:${port}`;

  // Reuse any reachable server on the requested port, regardless of origin.
  if (await pingDevServer(explicit)) {
    return { baseUrl: explicit, reusedExternal: true };
  }

  const existing = readPid(SERVER_PID_FILE);
  if (existing && isPidAlive(existing)) {
    const baseUrl = getDevBaseUrl();
    if (await pingDevServer(baseUrl)) {
      return { baseUrl, reusedExternal: false };
    }
  }

  writeFileSync(SERVER_PORT_FILE, String(port));
  writeFileSync(SERVER_LOG_FILE, "");

  const logPath = SERVER_LOG_FILE.replace(/"/g, '\\"');
  const cmd = `npm run dev > "${logPath}" 2>&1`;
  const child = spawn(cmd, {
    cwd: PROJECT_ROOT,
    shell: true,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, PORT: String(port) },
  });
  child.unref();

  if (!child.pid) {
    throw new Error("failed to spawn dev server");
  }
  writeFileSync(SERVER_PID_FILE, String(child.pid));

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pingDevServer(explicit)) {
      return { baseUrl: explicit, reusedExternal: false };
    }
    await sleep(750);
  }
  throw new Error(
    `dev server did not become ready within ${timeoutMs}ms. See ${SERVER_LOG_FILE}`,
  );
}

async function stopDevServer(): Promise<
  { stopped: boolean; pid: number | null }
> {
  const pid = readPid(SERVER_PID_FILE);
  if (!pid || !isPidAlive(pid)) {
    if (existsSync(SERVER_PID_FILE)) rmSync(SERVER_PID_FILE);
    return { stopped: false, pid };
  }
  killProcessTree(pid);
  if (!(await waitForProcessExit(pid, 10_000))) {
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
  if (existsSync(SERVER_PID_FILE)) rmSync(SERVER_PID_FILE);
  return { stopped: true, pid };
}

// ---------------------------------------------------------------------------
// Playwright auto-install
//
// We install Playwright + the chromium browser inside the skill's own folder
// (skills/test-frontend/node_modules) so the project's package.json stays
// untouched. On first run this step can take 1–2 minutes; subsequent runs
// short-circuit when playwright is already present.
// ---------------------------------------------------------------------------

function resolvePlaywrightPackage(): string | null {
  try {
    const req = createRequire(resolve(SKILL_DIR, "package.json"));
    return req.resolve("playwright");
  } catch {
    return null;
  }
}

function installPlaywrightIfNeeded(): void {
  if (resolvePlaywrightPackage()) return;

  // Ensure the skill has its own package.json so npm install writes into
  // skills/test-frontend/node_modules rather than the project root.
  const skillPackagePath = resolve(SKILL_DIR, "package.json");
  if (!existsSync(skillPackagePath)) {
    writeFileSync(
      skillPackagePath,
      JSON.stringify(
        {
          name: "test-frontend-skill",
          private: true,
          type: "module",
        },
        null,
        2,
      ),
    );
  }

  console.error(
    "[test-frontend] installing Playwright (one-time, ~1–2 min)…",
  );
  const install = spawnSync(
    "npm",
    ["install", "--no-audit", "--no-fund", "--loglevel=error", "playwright"],
    { cwd: SKILL_DIR, stdio: "inherit" },
  );
  if (install.status !== 0) {
    throw new Error(
      `playwright install failed (exit ${install.status}). See stderr above.`,
    );
  }

  console.error("[test-frontend] installing chromium browser…");
  const browser = spawnSync(
    "npx",
    ["playwright", "install", "chromium"],
    { cwd: SKILL_DIR, stdio: "inherit" },
  );
  if (browser.status !== 0) {
    throw new Error(
      `chromium install failed (exit ${browser.status}). See stderr above.`,
    );
  }
}

// ---------------------------------------------------------------------------
// IPC: driver <--> CLI. The driver listens on a loopback HTTP port and
// accepts JSON {action, args} via POST /cmd. Keeping it HTTP means the CLI
// uses plain fetch() with zero extra deps.
// ---------------------------------------------------------------------------

interface DriverCommand {
  action: string;
  args?: Record<string, unknown>;
}

interface DriverResponse {
  ok: boolean;
  [k: string]: unknown;
}

async function pingDriver(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/health`, {
      method: "GET",
    });
    return res.ok;
  } catch {
    return false;
  }
}

function readDriverPort(): number | null {
  if (!existsSync(DRIVER_PORT_FILE)) return null;
  const port = readNumber(DRIVER_PORT_FILE, 0);
  return port > 0 ? port : null;
}

async function sendToDriver(
  cmd: DriverCommand,
  timeoutMs = 120_000,
): Promise<DriverResponse> {
  const port = readDriverPort();
  if (!port) {
    throw new Error(
      "driver is not running. Run `tsx skills/test-frontend/run.ts start` first (or any command will auto-start it).",
    );
  }
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://localhost:${port}/cmd`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cmd),
      signal: controller.signal,
    });
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    if (!res.ok) {
      const reason = typeof body === "string"
        ? body
        : (body as { error?: string })?.error ?? JSON.stringify(body);
      throw new Error(`driver returned ${res.status}: ${reason}`);
    }
    return body as DriverResponse;
  } finally {
    clearTimeout(t);
  }
}

async function ensureDriverRunning(opts: {
  headed: boolean;
  devPort: number;
  devTimeoutMs: number;
  autoServer: boolean;
}): Promise<{ alreadyRunning: boolean; port: number }> {
  ensureSkillDir();
  const existing = readPid(DRIVER_PID_FILE);
  const existingPort = readDriverPort();
  if (existing && isPidAlive(existing) && existingPort) {
    if (await pingDriver(existingPort)) {
      return { alreadyRunning: true, port: existingPort };
    }
  }

  // Resolve base URL BEFORE spawning driver — if auto-server is on, we want
  // readiness errors surfaced to the caller, not hidden in the driver log.
  let baseUrl = getDevBaseUrl();
  if (opts.autoServer && !(await pingDevServer(baseUrl))) {
    const res = await ensureDevServer(opts.devPort, opts.devTimeoutMs);
    baseUrl = res.baseUrl;
  }

  installPlaywrightIfNeeded();

  writeFileSync(DRIVER_LOG_FILE, "");
  writeFileSync(
    STATE_FILE,
    JSON.stringify({ headed: opts.headed, baseUrl }, null, 2),
  );

  const logPath = DRIVER_LOG_FILE.replace(/"/g, '\\"');
  const runScript = resolve(SKILL_DIR, "run.ts").replace(/"/g, '\\"');
  // Launch the driver as a detached child. We re-invoke this same script with
  // the internal `__driver` verb so only one file ships with the skill.
  const cmd = `npx tsx "${runScript}" __driver > "${logPath}" 2>&1`;
  const child = spawn(cmd, {
    cwd: SKILL_DIR,
    shell: true,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      TEST_FRONTEND_BASE_URL: baseUrl,
      TEST_FRONTEND_HEADED: opts.headed ? "1" : "",
    },
  });
  child.unref();
  if (!child.pid) {
    throw new Error("failed to spawn Playwright driver");
  }
  writeFileSync(DRIVER_PID_FILE, String(child.pid));

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const port = readDriverPort();
    if (port && (await pingDriver(port))) {
      return { alreadyRunning: false, port };
    }
    if (!isPidAlive(child.pid)) {
      throw new Error(
        `driver exited before becoming ready. See ${DRIVER_LOG_FILE}`,
      );
    }
    await sleep(300);
  }
  throw new Error(
    `driver did not become ready within 90s. See ${DRIVER_LOG_FILE}`,
  );
}

async function stopDriver(): Promise<{ stopped: boolean; pid: number | null }> {
  const pid = readPid(DRIVER_PID_FILE);
  if (!pid || !isPidAlive(pid)) {
    if (existsSync(DRIVER_PID_FILE)) rmSync(DRIVER_PID_FILE);
    if (existsSync(DRIVER_PORT_FILE)) rmSync(DRIVER_PORT_FILE);
    return { stopped: false, pid };
  }
  // Graceful shutdown via HTTP first.
  const port = readDriverPort();
  if (port) {
    try {
      await fetch(`http://localhost:${port}/shutdown`, { method: "POST" });
    } catch {
      // fall through to signals
    }
  }
  if (!(await waitForProcessExit(pid, 5_000))) {
    killProcessTree(pid);
    if (!(await waitForProcessExit(pid, 5_000))) {
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
  }
  if (existsSync(DRIVER_PID_FILE)) rmSync(DRIVER_PID_FILE);
  if (existsSync(DRIVER_PORT_FILE)) rmSync(DRIVER_PORT_FILE);
  return { stopped: true, pid };
}

// ---------------------------------------------------------------------------
// Driver process — only runs when this script is invoked with the hidden
// verb `__driver`. It owns the Playwright browser and exposes HTTP verbs.
// ---------------------------------------------------------------------------

async function runDriver(): Promise<void> {
  // Playwright is resolved relative to skills/test-frontend because that is
  // the cwd set by `ensureDriverRunning`. The dynamic specifier + local
  // require keeps the CLI working on machines that haven't installed
  // playwright yet — the installer runs first and only then do we reach
  // this code path. Types are intentionally loose (any) so the file
  // type-checks without playwright being present in node_modules.
  const skillRequire = createRequire(resolve(SKILL_DIR, "package.json"));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pwModule: any = skillRequire("playwright");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { chromium } = pwModule as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Page = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type BrowserContext = any;

  const baseUrl = process.env.TEST_FRONTEND_BASE_URL ??
    `http://localhost:${DEFAULT_DEV_PORT}`;
  const headed = process.env.TEST_FRONTEND_HEADED === "1";

  const browser = await chromium.launch({ headless: !headed });
  const context: BrowserContext = await browser.newContext({
    baseURL: baseUrl,
  });

  // Single mutable "active page" ref so `new-page` / `close-page` transparently
  // rewire every subsequent command without rebuilding the handler table.
  const pageRef: { current: Page } = {
    current: await context.newPage(),
  };

  // Buffer recent console + network events per context so the CLI can fetch
  // them. Bound to the context, not a single page, so opening a new tab
  // keeps capturing.
  const consoleLog: Array<{
    type: string;
    text: string;
    at: string;
  }> = [];
  const networkLog: Array<{
    method: string;
    url: string;
    status?: number;
    at: string;
  }> = [];
  const MAX_LOG = 500;

  function attachPageListeners(p: Page): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p.on("console", (msg: any) => {
      consoleLog.push({
        type: msg.type(),
        text: msg.text(),
        at: new Date().toISOString(),
      });
      if (consoleLog.length > MAX_LOG) consoleLog.shift();
    });
    p.on("pageerror", (err: Error) => {
      consoleLog.push({
        type: "pageerror",
        text: err.message,
        at: new Date().toISOString(),
      });
      if (consoleLog.length > MAX_LOG) consoleLog.shift();
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p.on("request", (req: any) => {
      networkLog.push({
        method: req.method(),
        url: req.url(),
        at: new Date().toISOString(),
      });
      if (networkLog.length > MAX_LOG) networkLog.shift();
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p.on("response", (res: any) => {
      const url = res.url();
      const entry = [...networkLog].reverse().find((e) =>
        e.url === url && e.status === undefined
      );
      if (entry) entry.status = res.status();
    });
  }

  attachPageListeners(pageRef.current);
  // Any extra tab the SUT opens (window.open, target=_blank) also gets captured.
  context.on("page", (p: Page) => {
    attachPageListeners(p);
  });

  function page(): Page {
    return pageRef.current;
  }

  async function currentMeta(): Promise<{ url: string; title: string }> {
    const p = page();
    try {
      return { url: p.url(), title: await p.title() };
    } catch {
      return { url: p.url(), title: "" };
    }
  }

  type Handler = (args: Record<string, unknown>) => Promise<DriverResponse>;

  const handlers: Record<string, Handler> = {
    health: async () => ({ ok: true, baseUrl, headed }),

    goto: async (args) => {
      const url = String(args.url ?? "");
      if (!url) throw new Error("goto requires `url`");
      const res = await page().goto(url, {
        timeout: Number(args.timeout ?? DEFAULT_NAV_TIMEOUT_MS),
        waitUntil:
          (args.waitUntil as "load" | "domcontentloaded" | "networkidle") ??
            "load",
      });
      return { ok: true, status: res?.status(), ...(await currentMeta()) };
    },

    reload: async (args) => {
      await page().reload({
        timeout: Number(args.timeout ?? DEFAULT_NAV_TIMEOUT_MS),
      });
      return { ok: true, ...(await currentMeta()) };
    },

    back: async () => {
      await page().goBack();
      return { ok: true, ...(await currentMeta()) };
    },

    forward: async () => {
      await page().goForward();
      return { ok: true, ...(await currentMeta()) };
    },

    url: async () => ({ ok: true, url: page().url() }),

    title: async () => ({ ok: true, title: await page().title() }),

    click: async (args) => {
      const selector = requireSelector(args);
      await page().click(selector, {
        timeout: Number(args.timeout ?? DEFAULT_ACTION_TIMEOUT_MS),
        force: Boolean(args.force),
      });
      return { ok: true, selector, ...(await currentMeta()) };
    },

    "dblclick": async (args) => {
      const selector = requireSelector(args);
      await page().dblclick(selector, {
        timeout: Number(args.timeout ?? DEFAULT_ACTION_TIMEOUT_MS),
      });
      return { ok: true, selector, ...(await currentMeta()) };
    },

    fill: async (args) => {
      const selector = requireSelector(args);
      const value = String(args.value ?? "");
      await page().fill(selector, value, {
        timeout: Number(args.timeout ?? DEFAULT_ACTION_TIMEOUT_MS),
      });
      return { ok: true, selector, value, ...(await currentMeta()) };
    },

    type: async (args) => {
      const selector = requireSelector(args);
      const value = String(args.value ?? "");
      await page().type(selector, value, {
        timeout: Number(args.timeout ?? DEFAULT_ACTION_TIMEOUT_MS),
        delay: args.delay ? Number(args.delay) : undefined,
      });
      return { ok: true, selector, value, ...(await currentMeta()) };
    },

    press: async (args) => {
      const key = String(args.key ?? "");
      if (!key) throw new Error("press requires `key`");
      const selector = typeof args.selector === "string" ? args.selector : null;
      if (selector) {
        await page().press(selector, key, {
          timeout: Number(args.timeout ?? DEFAULT_ACTION_TIMEOUT_MS),
        });
      } else {
        await page().keyboard.press(key);
      }
      return { ok: true, key, selector, ...(await currentMeta()) };
    },

    select: async (args) => {
      const selector = requireSelector(args);
      const value = args.value;
      const values = Array.isArray(value)
        ? value.map(String)
        : [String(value ?? "")];
      const result = await page().selectOption(selector, values, {
        timeout: Number(args.timeout ?? DEFAULT_ACTION_TIMEOUT_MS),
      });
      return { ok: true, selector, selected: result, ...(await currentMeta()) };
    },

    check: async (args) => {
      const selector = requireSelector(args);
      await page().check(selector, {
        timeout: Number(args.timeout ?? DEFAULT_ACTION_TIMEOUT_MS),
      });
      return { ok: true, selector, ...(await currentMeta()) };
    },

    uncheck: async (args) => {
      const selector = requireSelector(args);
      await page().uncheck(selector, {
        timeout: Number(args.timeout ?? DEFAULT_ACTION_TIMEOUT_MS),
      });
      return { ok: true, selector, ...(await currentMeta()) };
    },

    hover: async (args) => {
      const selector = requireSelector(args);
      await page().hover(selector, {
        timeout: Number(args.timeout ?? DEFAULT_ACTION_TIMEOUT_MS),
      });
      return { ok: true, selector, ...(await currentMeta()) };
    },

    focus: async (args) => {
      const selector = requireSelector(args);
      await page().focus(selector, {
        timeout: Number(args.timeout ?? DEFAULT_ACTION_TIMEOUT_MS),
      });
      return { ok: true, selector };
    },

    "set-files": async (args) => {
      const selector = requireSelector(args);
      const files = Array.isArray(args.files)
        ? args.files.map(String)
        : [String(args.files ?? "")];
      await page().setInputFiles(selector, files, {
        timeout: Number(args.timeout ?? DEFAULT_ACTION_TIMEOUT_MS),
      });
      return { ok: true, selector, files };
    },

    text: async (args) => {
      const selector = requireSelector(args);
      const handle = await page().waitForSelector(selector, {
        timeout: Number(args.timeout ?? DEFAULT_ACTION_TIMEOUT_MS),
        state: "attached",
      });
      const text = (await handle.textContent()) ?? "";
      return { ok: true, selector, text };
    },

    html: async (args) => {
      const selector = requireSelector(args);
      const handle = await page().waitForSelector(selector, {
        timeout: Number(args.timeout ?? DEFAULT_ACTION_TIMEOUT_MS),
        state: "attached",
      });
      const html = await handle.innerHTML();
      return { ok: true, selector, html };
    },

    "page-html": async () => {
      const html = await page().content();
      return { ok: true, html };
    },

    value: async (args) => {
      const selector = requireSelector(args);
      const handle = await page().waitForSelector(selector, {
        timeout: Number(args.timeout ?? DEFAULT_ACTION_TIMEOUT_MS),
        state: "attached",
      });
      const value = await handle.inputValue();
      return { ok: true, selector, value };
    },

    attribute: async (args) => {
      const selector = requireSelector(args);
      const name = String(args.name ?? "");
      if (!name) throw new Error("attribute requires `name`");
      const handle = await page().waitForSelector(selector, {
        timeout: Number(args.timeout ?? DEFAULT_ACTION_TIMEOUT_MS),
        state: "attached",
      });
      const value = await handle.getAttribute(name);
      return { ok: true, selector, name, value };
    },

    exists: async (args) => {
      const selector = requireSelector(args);
      const count = await page().locator(selector).count();
      return { ok: true, selector, exists: count > 0, count };
    },

    count: async (args) => {
      const selector = requireSelector(args);
      const count = await page().locator(selector).count();
      return { ok: true, selector, count };
    },

    visible: async (args) => {
      const selector = requireSelector(args);
      const visible = await page().locator(selector).first().isVisible();
      return { ok: true, selector, visible };
    },

    "wait-for": async (args) => {
      const selector = requireSelector(args);
      const state =
        (args.state as "attached" | "detached" | "visible" | "hidden") ??
          "visible";
      await page().waitForSelector(selector, {
        timeout: Number(args.timeout ?? DEFAULT_ACTION_TIMEOUT_MS),
        state,
      });
      return { ok: true, selector, state };
    },

    "wait-for-text": async (args) => {
      const text = String(args.text ?? "");
      if (!text) throw new Error("wait-for-text requires `text`");
      const timeout = Number(args.timeout ?? DEFAULT_ACTION_TIMEOUT_MS);
      await page().waitForFunction(
        (t: string) => document.body && document.body.innerText.includes(t),
        text,
        { timeout },
      );
      return { ok: true, text };
    },

    "wait-for-url": async (args) => {
      const pattern = String(args.url ?? "");
      if (!pattern) throw new Error("wait-for-url requires `url`");
      await page().waitForURL(pattern, {
        timeout: Number(args.timeout ?? DEFAULT_NAV_TIMEOUT_MS),
      });
      return { ok: true, url: page().url() };
    },

    "wait-for-load": async (args) => {
      const state =
        (args.state as "load" | "domcontentloaded" | "networkidle") ??
          "networkidle";
      await page().waitForLoadState(state, {
        timeout: Number(args.timeout ?? DEFAULT_NAV_TIMEOUT_MS),
      });
      return { ok: true, state };
    },

    eval: async (args) => {
      const script = String(args.script ?? "");
      if (!script) throw new Error("eval requires `script`");
      // Wrap so callers can either supply an expression or a full statement
      // with an explicit `return`.
      const wrapped = `(async () => { ${
        script.includes("return") ? script : `return (${script});`
      } })()`;
      const result = await page().evaluate(wrapped);
      return { ok: true, result };
    },

    screenshot: async (args) => {
      if (!existsSync(SCREENSHOT_DIR)) {
        mkdirSync(SCREENSHOT_DIR, { recursive: true });
      }
      const explicit = typeof args.path === "string" && args.path.length > 0
        ? String(args.path)
        : null;
      const filename = explicit
        ? (explicit.startsWith("/")
          ? explicit
          : resolve(process.cwd(), explicit))
        : resolve(SCREENSHOT_DIR, `${Date.now()}.png`);
      mkdirSync(dirname(filename), { recursive: true });
      await page().screenshot({
        path: filename,
        fullPage: Boolean(args.fullPage),
      });
      return { ok: true, path: filename };
    },

    console: async (args) => {
      const tail = Number(args.tail ?? 100);
      const entries = tail > 0 ? consoleLog.slice(-tail) : consoleLog.slice();
      return { ok: true, entries };
    },

    network: async (args) => {
      const tail = Number(args.tail ?? 100);
      const entries = tail > 0 ? networkLog.slice(-tail) : networkLog.slice();
      return { ok: true, entries };
    },

    cookies: async () => {
      const cookies = await context.cookies();
      return { ok: true, cookies };
    },

    "set-cookie": async (args) => {
      const cookie = args.cookie;
      if (!cookie || typeof cookie !== "object") {
        throw new Error("set-cookie requires `cookie` object");
      }
      const c = cookie as Record<string, unknown>;
      const name = String(c.name ?? "");
      const value = String(c.value ?? "");
      if (!name) throw new Error("cookie.name is required");
      await context.addCookies([{
        name,
        value,
        url: typeof c.url === "string" ? String(c.url) : baseUrl,
        domain: typeof c.domain === "string" ? String(c.domain) : undefined,
        path: typeof c.path === "string" ? String(c.path) : "/",
        httpOnly: Boolean(c.httpOnly),
        secure: Boolean(c.secure),
        sameSite: c.sameSite as "Lax" | "Strict" | "None" | undefined,
      }]);
      return { ok: true };
    },

    "clear-cookies": async () => {
      await context.clearCookies();
      return { ok: true };
    },

    "local-storage": async (args) => {
      const op = String(args.op ?? "get");
      const key = typeof args.key === "string" ? args.key : null;
      const value = typeof args.value === "string" ? args.value : null;
      const result = await page().evaluate(
        (payload: { op: string; key: string | null; value: string | null }) => {
          const { op, key, value } = payload;
          if (op === "get" && key !== null) return localStorage.getItem(key);
          if (op === "set" && key !== null && value !== null) {
            localStorage.setItem(key, value);
            return value;
          }
          if (op === "remove" && key !== null) {
            localStorage.removeItem(key);
            return null;
          }
          if (op === "clear") {
            localStorage.clear();
            return null;
          }
          if (op === "keys") return Object.keys(localStorage);
          if (op === "all") {
            const out: Record<string, string> = {};
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              if (k) out[k] = localStorage.getItem(k) ?? "";
            }
            return out;
          }
          throw new Error(`unknown local-storage op: ${op}`);
        },
        { op, key, value },
      );
      return { ok: true, op, key, result };
    },

    "new-page": async () => {
      const p = await context.newPage();
      // Listeners are attached via context.on("page", …) above.
      pageRef.current = p;
      return { ok: true, ...(await currentMeta()) };
    },

    "close-page": async () => {
      const current = page();
      const others = context.pages().filter((p: Page) => p !== current);
      await current.close();
      if (others.length > 0) {
        pageRef.current = others[others.length - 1];
      } else {
        // Always keep at least one page alive so subsequent commands work.
        pageRef.current = await context.newPage();
      }
      return { ok: true, ...(await currentMeta()) };
    },

    reset: async () => {
      // Clear cookies + storage + navigate to about:blank. Cheaper than
      // closing + re-opening the browser.
      await context.clearCookies();
      try {
        await page().evaluate(() => {
          localStorage.clear();
          sessionStorage.clear();
        });
      } catch {
        // about:blank won't have storage contexts — ignore.
      }
      await page().goto("about:blank");
      consoleLog.length = 0;
      networkLog.length = 0;
      return { ok: true };
    },

    login: async (args) => {
      // Convenience verb: the seeded superuser login flow. Handy because it
      // is the single most common starting point for any authenticated test.
      const identifier = String(args.identifier ?? DEFAULT_SUPERUSER_EMAIL);
      const password = String(args.password ?? DEFAULT_SUPERUSER_PASSWORD);
      const target = `${baseUrl.replace(/\/$/, "")}/login`;
      const p = page();
      await p.goto(target, {
        waitUntil: "load",
        timeout: DEFAULT_NAV_TIMEOUT_MS,
      });
      const filledIdentifier = await fillFirst(p, [
        'input[name="identifier"]',
        'input[name="email"]',
        'input[type="email"]',
        'input[type="text"]',
      ], identifier);
      if (!filledIdentifier) {
        throw new Error("login: could not find identifier input on /login");
      }
      const filledPassword = await fillFirst(p, [
        'input[name="password"]',
        'input[type="password"]',
      ], password);
      if (!filledPassword) {
        throw new Error("login: could not find password input on /login");
      }
      const submit = p.locator(
        'button[type="submit"], button:has-text("Entrar"), button:has-text("Sign In"), button:has-text("Login")',
      ).first();
      await submit.click({ timeout: DEFAULT_ACTION_TIMEOUT_MS });
      await p.waitForURL((u: URL) => !String(u).includes("/login"), {
        timeout: DEFAULT_NAV_TIMEOUT_MS,
      });
      return { ok: true, ...(await currentMeta()) };
    },
  };

  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, baseUrl, headed }));
      return;
    }
    if (req.method === "POST" && req.url === "/shutdown") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, shutting_down: true }));
      // Close everything then exit.
      setTimeout(() => {
        void (async () => {
          try {
            await context.close();
          } catch { /* ignore */ }
          try {
            await browser.close();
          } catch { /* ignore */ }
          process.exit(0);
        })();
      }, 50);
      return;
    }
    if (req.method !== "POST" || req.url !== "/cmd") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "not found" }));
      return;
    }
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString("utf-8");
      const cmd = JSON.parse(raw) as DriverCommand;
      const handler = handlers[cmd.action];
      if (!handler) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({
          ok: false,
          error: `unknown action: ${cmd.action}`,
        }));
        return;
      }
      const result = await handler(cmd.args ?? {});
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({
        ok: false,
        error: (err as Error).message,
        stack: (err as Error).stack,
      }));
    }
  });

  // Bind to a random free port and write it to the port file so the CLI
  // can find us.
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      writeFileSync(DRIVER_PORT_FILE, String(port));
      resolvePromise();
    });
  });

  // Keep the process alive. Cleanup on signals.
  const shutdown = () => {
    void (async () => {
      try {
        server.close();
      } catch { /* ignore */ }
      try {
        await context.close();
      } catch { /* ignore */ }
      try {
        await browser.close();
      } catch { /* ignore */ }
      process.exit(0);
    })();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

function requireSelector(args: Record<string, unknown>): string {
  const selector = typeof args.selector === "string" ? args.selector : "";
  if (!selector) throw new Error("this action requires `selector`");
  return selector;
}

async function fillFirst(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any,
  selectors: string[],
  value: string,
): Promise<boolean> {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    try {
      if ((await loc.count()) > 0 && (await loc.isVisible())) {
        await loc.fill(value, { timeout: DEFAULT_ACTION_TIMEOUT_MS });
        return true;
      }
    } catch {
      // try next
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// CLI argument parsing — every verb is a thin wrapper over a driver action.
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(
    [
      "test-frontend — drive a real browser (Playwright) against the project's test database.",
      "",
      "USAGE",
      "  tsx skills/test-frontend/run.ts <command> [args]",
      "",
      "LIFECYCLE",
      "  start [--headed] [--port N] [--timeout ms] [--no-auto-server]",
      "  stop                                (stops browser driver)",
      "  stop --all                          (stops browser AND dev server)",
      "  status                              (prints JSON with driver + server state)",
      "  logs [--tail N] [--server]          (driver log by default; --server for dev log)",
      "  reset                               (clears cookies, storage, navigates to about:blank)",
      "",
      "NAVIGATION",
      "  goto <path-or-url>                  (e.g. /login, /api/public/front-core, https://...)",
      "  reload",
      "  back | forward",
      "  url | title",
      "  wait-for-url <pattern>",
      "  wait-for-load [--state load|domcontentloaded|networkidle]",
      "",
      "INTERACTION",
      "  click <selector>",
      "  dblclick <selector>",
      "  fill <selector> <value>",
      "  type <selector> <value> [--delay ms]",
      "  press <key> [--selector CSS]                (e.g. Enter, Tab, Escape)",
      "  select <selector> <value>                   (repeat --value for multi-select)",
      "  check <selector> | uncheck <selector>",
      "  hover <selector> | focus <selector>",
      "  set-files <selector> <path> [<path>...]",
      "",
      "ASSERTIONS / READ",
      "  text <selector>                             (textContent of first match)",
      "  html <selector> | page-html",
      "  value <selector>                            (input value)",
      "  attribute <selector> <name>",
      "  exists <selector> | count <selector>",
      "  visible <selector>",
      "  wait-for <selector> [--state attached|detached|visible|hidden]",
      "  wait-for-text <text>",
      "",
      "INSPECTION",
      "  screenshot [path] [--full-page]",
      "  console [--tail N]                          (captured console messages)",
      "  network [--tail N]                          (captured network requests)",
      "  cookies | set-cookie <json> | clear-cookies",
      "  local-storage <get|set|remove|clear|keys|all> [key] [value]",
      "",
      "CONVENIENCE",
      "  login [--identifier EMAIL] [--password PWD]  (seeded superuser: core@admin.com / core1234)",
      "  eval <js-expression>                          (escape hatch; runs in page context)",
      "  new-page                                      (opens a new tab; becomes active)",
      "  close-page                                    (closes active tab)",
      "",
      "COMMON FLAGS",
      "  --timeout <ms>                                (per-action timeout; default 30000)",
      "  --base-url <url>                              (applies only to `start`; default auto-resolved)",
      "  --headed                                      (opens a visible browser window)",
      "",
      "EXAMPLES",
      "  # Everything auto-starts — first call installs Playwright + chromium and launches the dev server.",
      "  tsx skills/test-frontend/run.ts goto /login",
      "  tsx skills/test-frontend/run.ts fill 'input[name=\"identifier\"]' core@admin.com",
      "  tsx skills/test-frontend/run.ts fill 'input[name=\"password\"]' core1234",
      "  tsx skills/test-frontend/run.ts click 'button[type=\"submit\"]'",
      "  tsx skills/test-frontend/run.ts wait-for-url '**/entry'",
      "  tsx skills/test-frontend/run.ts screenshot logged-in.png",
      "",
      "  # Or skip the manual form drive — one-shot superuser login:",
      "  tsx skills/test-frontend/run.ts login",
      "",
      "  # Read state back",
      "  tsx skills/test-frontend/run.ts text 'h1'",
      "  tsx skills/test-frontend/run.ts console --tail 50",
      "",
      "  # When you're done",
      "  tsx skills/test-frontend/run.ts stop --all",
      "",
      "RULES",
      '  - database.json must carry `"test": true` (refuses otherwise).',
      "  - First run installs Playwright + chromium into skills/test-frontend/node_modules (~1–2 min).",
      "  - Any command auto-starts the driver + dev server if they are not already running.",
      "  - The driver keeps a single browser context alive across commands, so state persists.",
      "  - Uses node:* specifiers so the shape is runtime-agnostic — same style Deno accepts.",
    ].join("\n"),
  );
}

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
        // Collect repeated flags as arrays (e.g. --value).
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

async function runCli(argv: string[]): Promise<number> {
  if (argv.length === 0) {
    printHelp();
    return 0;
  }
  const cmd = argv[0];
  const rest = argv.slice(1);

  switch (cmd) {
    case "help":
    case "-h":
    case "--help":
      printHelp();
      return 0;

    case "__driver":
      // Internal: the detached driver loop.
      await runDriver();
      return 0;

    case "start":
      return cmdStart(rest);

    case "stop":
      return cmdStop(rest);

    case "status":
      return cmdStatus();

    case "logs":
      return cmdLogs(rest);
  }

  // Any remaining verb is routed to the driver. Validate the verb FIRST so
  // typos don't trigger an expensive driver auto-start.
  let mapped: { action: string; args: Record<string, unknown> };
  try {
    mapped = mapVerbToAction(cmd, rest);
  } catch (err) {
    console.error(`[test-frontend] ${(err as Error).message}`);
    printHelp();
    return 1;
  }

  try {
    await ensureDriverRunningFromCli();
  } catch (err) {
    console.error(`[test-frontend] ${(err as Error).message}`);
    return 1;
  }

  const timeoutMs = typeof mapped.args.timeout === "number"
    ? Number(mapped.args.timeout) + 5_000
    : 120_000;
  try {
    const result = await sendToDriver(
      { action: mapped.action, args: mapped.args },
      timeoutMs,
    );
    console.log(JSON.stringify(result, null, 2));
    return result.ok === false ? 1 : 0;
  } catch (err) {
    console.error(`[test-frontend] ${(err as Error).message}`);
    return 1;
  }
}

async function ensureDriverRunningFromCli(): Promise<void> {
  const existing = readPid(DRIVER_PID_FILE);
  const port = readDriverPort();
  if (existing && isPidAlive(existing) && port && (await pingDriver(port))) {
    return;
  }
  await ensureDriverRunning({
    headed: false,
    devPort: DEFAULT_DEV_PORT,
    devTimeoutMs: 180_000,
    autoServer: true,
  });
}

async function cmdStart(rest: string[]): Promise<number> {
  const { flags } = parseArgs(rest);
  const headed = flags.headed === true;
  const port = typeof flags.port === "string"
    ? Number(flags.port)
    : DEFAULT_DEV_PORT;
  const timeoutMs = typeof flags.timeout === "string"
    ? Number(flags.timeout)
    : 180_000;
  const autoServer = flags["no-auto-server"] !== true;

  try {
    const res = await ensureDriverRunning({
      headed,
      devPort: port,
      devTimeoutMs: timeoutMs,
      autoServer,
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          driver: { port: res.port, alreadyRunning: res.alreadyRunning },
          baseUrl: getDevBaseUrl(),
          pidFile: DRIVER_PID_FILE,
          logFile: DRIVER_LOG_FILE,
        },
        null,
        2,
      ),
    );
    return 0;
  } catch (err) {
    console.error(`[test-frontend] ${(err as Error).message}`);
    return 1;
  }
}

async function cmdStop(rest: string[]): Promise<number> {
  const { flags } = parseArgs(rest);
  const stopAll = flags.all === true;
  const driver = await stopDriver();
  let server: { stopped: boolean; pid: number | null } | null = null;
  if (stopAll) {
    server = await stopDevServer();
  }
  console.log(JSON.stringify({ ok: true, driver, server }, null, 2));
  return 0;
}

async function cmdStatus(): Promise<number> {
  const driverPid = readPid(DRIVER_PID_FILE);
  const driverPort = readDriverPort();
  const driverAlive = driverPid ? isPidAlive(driverPid) : false;
  const driverReachable = driverPort ? await pingDriver(driverPort) : false;

  const serverPid = readPid(SERVER_PID_FILE);
  const serverAlive = serverPid ? isPidAlive(serverPid) : false;
  const baseUrl = getDevBaseUrl();
  const serverReachable = await pingDevServer(baseUrl);

  const payload = {
    ok: true,
    driver: {
      pid: driverPid,
      alive: driverAlive,
      port: driverPort,
      reachable: driverReachable,
      logFile: existsSync(DRIVER_LOG_FILE) ? DRIVER_LOG_FILE : null,
    },
    devServer: {
      pid: serverPid,
      alive: serverAlive,
      baseUrl,
      reachable: serverReachable,
      logFile: existsSync(SERVER_LOG_FILE) ? SERVER_LOG_FILE : null,
    },
  };
  console.log(JSON.stringify(payload, null, 2));
  return driverReachable && serverReachable ? 0 : 1;
}

async function cmdLogs(rest: string[]): Promise<number> {
  const { flags } = parseArgs(rest);
  const file = flags.server === true ? SERVER_LOG_FILE : DRIVER_LOG_FILE;
  const tail = typeof flags.tail === "string" ? Number(flags.tail) : 50;
  if (!existsSync(file)) {
    console.log("");
    return 0;
  }
  const raw = readFileSync(file, "utf-8");
  const lines = raw.split("\n");
  const sliced = flags.all === true ? lines : lines.slice(-tail);
  console.log(sliced.join("\n"));
  return 0;
}

function mapVerbToAction(
  verb: string,
  rest: string[],
): { action: string; args: Record<string, unknown> } {
  const { positional, flags } = parseArgs(rest);
  const timeout = typeof flags.timeout === "string"
    ? Number(flags.timeout)
    : undefined;

  switch (verb) {
    case "goto":
      return {
        action: "goto",
        args: {
          url: positional[0] ?? "",
          timeout,
          waitUntil: flags["wait-until"],
        },
      };
    case "reload":
      return { action: "reload", args: { timeout } };
    case "back":
      return { action: "back", args: {} };
    case "forward":
      return { action: "forward", args: {} };
    case "url":
      return { action: "url", args: {} };
    case "title":
      return { action: "title", args: {} };

    case "click":
      return {
        action: "click",
        args: {
          selector: positional[0] ?? "",
          timeout,
          force: flags.force === true,
        },
      };
    case "dblclick":
      return {
        action: "dblclick",
        args: { selector: positional[0] ?? "", timeout },
      };
    case "fill":
      return {
        action: "fill",
        args: {
          selector: positional[0] ?? "",
          value: positional[1] ?? "",
          timeout,
        },
      };
    case "type":
      return {
        action: "type",
        args: {
          selector: positional[0] ?? "",
          value: positional[1] ?? "",
          timeout,
          delay: flags.delay,
        },
      };
    case "press":
      return {
        action: "press",
        args: {
          key: positional[0] ?? "",
          selector: typeof flags.selector === "string"
            ? flags.selector
            : undefined,
          timeout,
        },
      };
    case "select": {
      const value = Array.isArray(flags.value)
        ? (flags.value as string[])
        : typeof flags.value === "string"
        ? [flags.value]
        : positional.slice(1);
      return {
        action: "select",
        args: { selector: positional[0] ?? "", value, timeout },
      };
    }
    case "check":
      return {
        action: "check",
        args: { selector: positional[0] ?? "", timeout },
      };
    case "uncheck":
      return {
        action: "uncheck",
        args: { selector: positional[0] ?? "", timeout },
      };
    case "hover":
      return {
        action: "hover",
        args: { selector: positional[0] ?? "", timeout },
      };
    case "focus":
      return {
        action: "focus",
        args: { selector: positional[0] ?? "", timeout },
      };
    case "set-files":
      return {
        action: "set-files",
        args: {
          selector: positional[0] ?? "",
          files: positional.slice(1),
          timeout,
        },
      };

    case "text":
      return {
        action: "text",
        args: { selector: positional[0] ?? "", timeout },
      };
    case "html":
      return {
        action: "html",
        args: { selector: positional[0] ?? "", timeout },
      };
    case "page-html":
      return { action: "page-html", args: {} };
    case "value":
      return {
        action: "value",
        args: { selector: positional[0] ?? "", timeout },
      };
    case "attribute":
      return {
        action: "attribute",
        args: {
          selector: positional[0] ?? "",
          name: positional[1] ?? "",
          timeout,
        },
      };
    case "exists":
      return { action: "exists", args: { selector: positional[0] ?? "" } };
    case "count":
      return { action: "count", args: { selector: positional[0] ?? "" } };
    case "visible":
      return { action: "visible", args: { selector: positional[0] ?? "" } };
    case "wait-for":
      return {
        action: "wait-for",
        args: {
          selector: positional[0] ?? "",
          state: flags.state,
          timeout,
        },
      };
    case "wait-for-text":
      return {
        action: "wait-for-text",
        args: { text: positional[0] ?? "", timeout },
      };
    case "wait-for-url":
      return {
        action: "wait-for-url",
        args: { url: positional[0] ?? "", timeout },
      };
    case "wait-for-load":
      return {
        action: "wait-for-load",
        args: { state: flags.state, timeout },
      };

    case "eval":
      return { action: "eval", args: { script: positional.join(" ") } };

    case "screenshot":
      return {
        action: "screenshot",
        args: {
          path: positional[0],
          fullPage: flags["full-page"] === true,
        },
      };

    case "console":
      return {
        action: "console",
        args: { tail: flags.tail ? Number(flags.tail) : 100 },
      };
    case "network":
      return {
        action: "network",
        args: { tail: flags.tail ? Number(flags.tail) : 100 },
      };

    case "cookies":
      return { action: "cookies", args: {} };
    case "set-cookie": {
      const raw = positional[0] ?? "{}";
      return {
        action: "set-cookie",
        args: { cookie: JSON.parse(raw) },
      };
    }
    case "clear-cookies":
      return { action: "clear-cookies", args: {} };

    case "local-storage":
      return {
        action: "local-storage",
        args: {
          op: positional[0] ?? "get",
          key: positional[1],
          value: positional[2],
        },
      };

    case "new-page":
      return { action: "new-page", args: {} };
    case "close-page":
      return { action: "close-page", args: {} };

    case "reset":
      return { action: "reset", args: {} };

    case "login":
      return {
        action: "login",
        args: {
          identifier: flags.identifier,
          password: flags.password,
        },
      };

    default:
      throw new Error(
        `unknown command: ${verb}. Run 'help' for the full list.`,
      );
  }
}

try {
  const code = await runCli(process.argv.slice(2));
  process.exit(code);
} catch (err) {
  console.error("[test-frontend] fatal:", (err as Error).stack ?? err);
  process.exit(1);
}
