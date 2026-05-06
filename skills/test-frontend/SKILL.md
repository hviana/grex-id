---
name: test-frontend
description: Use whenever the user wants to drive a web page in a real browser — open a page, click a button, fill a form, read the DOM, take a screenshot, inspect the console, reproduce a UI flow end-to-end, verify that a React change actually renders. The skill defaults to the project's own dev server, but every navigation verb (`goto`, `wait-for-url`, `screenshot`, etc.) accepts **absolute external URLs** too — so it can drive third-party pages like OAuth consent screens, payment-provider redirects, email-provider web UIs, webhook callback URLs, or any http/https page. Trigger on phrases like "open the browser", "click this button", "test the login UI", "fill the register form", "see what happens on /billing", "screenshot the page", "check for console errors", "open this external URL", "follow the redirect to the provider page". The skill launches Playwright (Chromium), owns a single browser session across commands, auto-starts the Next.js dev server when a relative path is navigated to, and exposes simple verbs (`goto`, `click`, `fill`, `screenshot`, `console`, …). First run auto-installs Playwright + Chromium into the skill's own folder — no project dependency is added. It refuses to start unless `database.json` explicitly carries `"test": true`.
---

# Test Frontend

Drive the project's frontend in a real Chromium browser. Every action a user can
take — navigating, clicking, typing, submitting, uploading, reading rendered
text, watching console/network — is exposed as a tiny CLI verb. State persists
across commands (the browser, cookies, localStorage, the currently open page) so
a test flow is just a sequence of one-line invocations.

## When to use

- Exercise a UI change in a real browser instead of guessing at renderer
  behaviour.
- Reproduce a user flow end-to-end: login → onboarding → feature → sign out.
- Verify a form actually submits, a modal actually opens, a spinner actually
  renders, a redirect actually fires.
- Inspect console errors or network calls that a change introduced.
- Capture screenshots for bug reports.
- Run a quick click-through after editing a component — the driver stays alive
  between commands so iteration is fast.

## External URLs

Every verb that takes a URL argument (`goto`, `wait-for-url`, pages opened via
`window.open`, …) accepts **any absolute http/https URL** — not just paths on
the project's dev server. The skill keeps one persistent browser context, so you
can start on a local page, follow a redirect out to a third-party domain (OAuth
consent, payment provider, email-inbox preview), interact there, and come back —
cookies for each origin are retained per Playwright's normal isolation rules.

When the **first** navigation verb of a session is an absolute external URL, the
skill skips the auto-start of the Next.js dev server (it would be wasted — the
test doesn't need it). Relative paths always auto-start the server as before.
Example:

```bash
# No local dev server needed here — external URL only.
node --conditions=react-server skills/test-frontend/run.ts goto https://example.com/pricing
node --conditions=react-server skills/test-frontend/run.ts text 'h1'
node --conditions=react-server skills/test-frontend/run.ts screenshot external.png --full-page

# Mixed: start on the app, follow the external OAuth hop, come back.
node --conditions=react-server skills/test-frontend/run.ts goto /login
node --conditions=react-server skills/test-frontend/run.ts click 'button:has-text("Sign in with Google")'
node --conditions=react-server skills/test-frontend/run.ts wait-for-url 'accounts.google.com/**'
# … drive the external form …
node --conditions=react-server skills/test-frontend/run.ts wait-for-url '**/entry'
```

## When NOT to use

- Production traffic. The skill refuses to start unless `database.json` has
  `"test": true`.
- Pure API testing. Use **test-routes** for direct HTTP calls without a browser.
- Pure DB inspection. Use **test-db-queries**.
- Visual regression / snapshot suites. This is an interactive driver, not a test
  runner.
- Load or performance testing.

## Prerequisites

1. Open `database.json` and confirm the `url` / `user` / `pass` / `namespace` /
   `database` point at a **test** database — never production.
2. Set `"test": true` in `database.json`. The skill hard-exits with a loud error
   message otherwise.
3. When finished, flip `"test"` back to `false` so future runs refuse until
   someone re-confirms.
4. That's it. `npm`, `npx`, and `node` are the only host binaries needed — the
   skill installs Playwright + Chromium into `skills/test-frontend/node_modules`
   on first run (takes ~1–2 minutes). The project's own `package.json` is never
   modified.

## Typical session

```bash
# Any command auto-starts the driver + dev server on first use.
# You can also start explicitly to control the port or run headed:
node --conditions=react-server skills/test-frontend/run.ts start --headed

# One-shot superuser login (the single most common starting point)
node --conditions=react-server skills/test-frontend/run.ts login

# Navigate
node --conditions=react-server skills/test-frontend/run.ts goto /billing

# Interact
node --conditions=react-server skills/test-frontend/run.ts click 'button:has-text("Add Payment Method")'
node --conditions=react-server skills/test-frontend/run.ts fill 'input[name="number"]' 4111111111111111

# Read state
node --conditions=react-server skills/test-frontend/run.ts text 'h1'
node --conditions=react-server skills/test-frontend/run.ts console --tail 50
node --conditions=react-server skills/test-frontend/run.ts network --tail 50

# Capture
node --conditions=react-server skills/test-frontend/run.ts screenshot billing.png --full-page

# Shut down when done
node --conditions=react-server skills/test-frontend/run.ts stop --all
```

Output is always a small JSON envelope on stdout (so downstream tooling can
parse it); any action that fails exits non-zero with a concise error on stderr.

## How it works (one paragraph)

A long-lived **driver** process hosts Playwright and owns one Chromium browser
with one persistent context. The CLI is a thin wrapper that sends JSON
`{action, args}` to the driver over a loopback HTTP socket. State — cookies,
localStorage, the currently active tab, buffered console/network logs — lives
inside the driver, so a sequence of unrelated-looking commands composes into a
coherent test flow. The dev server is started separately (reusing any server
already started by `test-routes`) and the driver is auto-spawned on the first
verb you run.

## Subcommands

### Lifecycle

| Verb     | Description                                                                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start`  | Start driver + dev server. Idempotent. `--headed` opens a visible window; `--port N` picks a dev port; `--no-auto-server` skips the Next.js spawn (useful when `test-routes` already started it). |
| `stop`   | Stop the driver. `--all` also stops the dev server.                                                                                                                                               |
| `status` | Print JSON describing driver pid/port/reachability and dev-server state. Exit `0` when both are reachable.                                                                                        |
| `logs`   | Tail the driver log. `--server` switches to the dev-server log. `--tail N` / `--all`.                                                                                                             |
| `doctor` | Diagnose the environment: `database.json` test flag, project-local `tsx`, Playwright, Chromium binary, orphan pid/port files. Prints JSON and exits 0 when everything is usable.                  |
| `reset`  | Clear cookies + localStorage + sessionStorage, navigate to `about:blank`, clear captured console/network logs.                                                                                    |

The driver **auto-starts on first use** of any verb below — you do not need to
call `start` explicitly unless you want `--headed` or a custom port.

### Navigation

| Verb               | Args                                          | Description                                                                                                                                                                                                                                                             |
| ------------------ | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `goto`             | `<path-or-url>`                               | Navigate to a relative path like `/foo` (resolved against the dev server) **or any absolute URL** — `https://provider.example.com/oauth/authorize`, a Gmail web link, a payment-provider callback, etc. External URLs skip the dev-server auto-start and open directly. |
| `reload`           | —                                             | Reload the current page.                                                                                                                                                                                                                                                |
| `back` / `forward` | —                                             | Navigate history.                                                                                                                                                                                                                                                       |
| `url`              | —                                             | Print the current URL.                                                                                                                                                                                                                                                  |
| `title`            | —                                             | Print the document title.                                                                                                                                                                                                                                               |
| `wait-for-url`     | `<glob-or-regex>`                             | Wait until the URL matches (Playwright patterns).                                                                                                                                                                                                                       |
| `wait-for-load`    | `--state load\|domcontentloaded\|networkidle` | Wait for a load state (default `networkidle`).                                                                                                                                                                                                                          |

### Interaction

| Verb        | Args                                  | Description                                                   |
| ----------- | ------------------------------------- | ------------------------------------------------------------- |
| `click`     | `<selector>` `[--force]`              | Click the first match. Waits for it to be clickable.          |
| `dblclick`  | `<selector>`                          | Double-click.                                                 |
| `fill`      | `<selector>` `<value>`                | Clear the input and fill it. Use for text inputs / textareas. |
| `type`      | `<selector>` `<value>` `[--delay ms]` | Type key by key (useful for inputs with per-key listeners).   |
| `press`     | `<key>` `[--selector CSS]`            | Press a key (e.g. `Enter`, `Escape`, `Tab`, `ArrowDown`).     |
| `select`    | `<selector>` `<value>…`               | Select option(s) on a `<select>`.                             |
| `check`     | `<selector>`                          | Check a checkbox / radio.                                     |
| `uncheck`   | `<selector>`                          | Uncheck a checkbox.                                           |
| `hover`     | `<selector>`                          | Hover over an element.                                        |
| `focus`     | `<selector>`                          | Focus an element.                                             |
| `set-files` | `<selector>` `<path>…`                | Attach file(s) to an `<input type="file">`.                   |

### Read / assert

| Verb            | Args                                                         | Description                                          |
| --------------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| `text`          | `<selector>`                                                 | `textContent` of the first match.                    |
| `html`          | `<selector>`                                                 | `innerHTML` of the first match.                      |
| `page-html`     | —                                                            | `document.documentElement.outerHTML`.                |
| `value`         | `<selector>`                                                 | `.value` of an input / textarea / select.            |
| `attribute`     | `<selector>` `<name>`                                        | Value of an HTML attribute.                          |
| `exists`        | `<selector>`                                                 | `{ exists: bool, count: n }`.                        |
| `count`         | `<selector>`                                                 | Number of matching nodes.                            |
| `visible`       | `<selector>`                                                 | Whether the first match is currently visible.        |
| `wait-for`      | `<selector>` `[--state attached\|detached\|visible\|hidden]` | Wait until the selector reaches a state.             |
| `wait-for-text` | `<substring>`                                                | Wait until the document body contains the substring. |

### Capture / inspect

| Verb            | Args                                                   | Description                                                                                                                |
| --------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `screenshot`    | `[path]` `[--full-page]`                               | Save a PNG. Default path: `skills/test-frontend/screenshots/<ts>.png`. Relative paths resolve from your working directory. |
| `console`       | `[--tail N]`                                           | Recent console messages (default 100). Includes `pageerror` entries.                                                       |
| `network`       | `[--tail N]`                                           | Recent HTTP requests issued by the page. Response status is stitched in when available.                                    |
| `cookies`       | —                                                      | Print all cookies in the current context.                                                                                  |
| `set-cookie`    | `<json>`                                               | Add a cookie, e.g. `'{"name":"foo","value":"bar","url":"http://localhost:3000"}'`.                                         |
| `clear-cookies` | —                                                      | Clear all cookies.                                                                                                         |
| `local-storage` | `get\|set\|remove\|clear\|keys\|all` `[key]` `[value]` | Interact with `localStorage` of the active page.                                                                           |

### Tabs

| Verb         | Description                                    |
| ------------ | ---------------------------------------------- |
| `new-page`   | Open a new tab; it becomes the active page.    |
| `close-page` | Close the active tab; reverts to the last one. |

### Escape hatches

| Verb                 | Args                                | Description                                                                                                                                                                                                                                         |
| -------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eval`               | `<js>`                              | Run JS in the page context. Expressions are auto-wrapped; include `return` for multi-statement blocks. Returns the serialized value.                                                                                                                |
| `login`              | `[--identifier X]` `[--password Y]` | Drives `/login` with the seeded superuser (`core@admin.com` / `core1234`). Calls `resolve-challenges` before and after submit; escalates with a clear error if a challenge blocks the flow (e.g. real CAPTCHA, MFA gate).                           |
| `resolve-challenges` | `[--skip <id>]…`                    | Scans the active page for known blockers (cookie-consent banner, bot-protection stub, Next.js dev-error overlay, native alert/confirm/prompt) and auto-dismisses them. Returns `{ resolved: [...], unresolved: [...], humanActionRequired: bool }`. |

### Challenge resolver — general rule

**Whenever a verb could encounter a transient overlay, stub, or gate that is not
part of the feature being tested, the skill tries to resolve it automatically
first and only escalates to the caller when it can't.** This applies to login,
but it is not specific to login — the same resolver runs for any high-level flow
you build on top of the skill.

Recognised challenges today:

- `cookie-consent` — LGPD / cookie banner blocking clicks (§9.8). Auto-accept.
- `bot-protection` — "Não sou um robô" / "I'm not a robot" stub button.
  Auto-click. If a real reCAPTCHA / hCaptcha iframe opens after the click, the
  resolver reports `humanActionRequired: true` with a hint pointing at
  `start --headed`.
- `nextjs-error-overlay` — Next.js dev-error overlay. **Never auto-dismissed.**
  The resolver extracts the error message and escalates with
  `humanActionRequired: true` so the operator fixes the real bug instead of
  clicking past it.
- Native dialogs (`alert` / `confirm` / `prompt`) — handled by a page-level
  listener that auto-accepts and logs the message into the `console` buffer, so
  they never silently hang.

When an unresolvable challenge appears, the CLI prints a concrete `hint`
explaining what to do next — typically one of:

1. Drive the remaining step manually with individual verbs (`click`, `fill`,
   `press Enter`, …).
2. Re-run with `start --headed` so a human can complete the challenge in a
   visible browser window.
3. Turn off the feature in the test environment (e.g. unset
   `front.botProtection.siteKey`).

Any new gate the platform introduces (e.g. MFA prompt, consent checkbox on a
subframework page) can be taught to the resolver by adding a detector + resolver
pair to the `CHALLENGES` array in `run.ts` — no change to existing callers. The
`login` verb is just the first consumer.

## Common flags

- `--timeout <ms>` — per-action timeout (default 30 000 for actions, 60 000 for
  navigation).
- `--headed` — only valid on `start`; opens a visible Chromium window (handy
  when you want to watch the flow live).

## Output

Every command prints a JSON envelope, e.g.:

```json
{
  "ok": true,
  "status": 200,
  "url": "http://localhost:3000/login",
  "title": "Login — Core"
}
```

`screenshot` returns the absolute path:

```json
{
  "ok": true,
  "path": "/home/.../skills/test-frontend/screenshots/1700000000.png"
}
```

Errors from the skill itself (driver not reachable, unknown command, Playwright
install failure) go to **stderr** prefixed with `[test-frontend]` and exit
non-zero. The normal command output always goes to **stdout**.

## State files

All state lives under `skills/test-frontend/` and is listed in `.gitignore`:

| File            | Purpose                                           |
| --------------- | ------------------------------------------------- |
| `.driver.pid`   | PID of the detached Playwright driver.            |
| `.driver.port`  | Loopback port the driver's IPC server listens on. |
| `.driver.log`   | stdout + stderr of the driver since start.        |
| `.server.pid`   | PID of the detached `npm run dev` process.        |
| `.server.port`  | Port the dev server is bound to.                  |
| `.server.log`   | stdout + stderr of the dev server since start.    |
| `screenshots/`  | Default screenshot output directory.              |
| `node_modules/` | Isolated Playwright install (auto-managed).       |

Delete any of them freely when things look stuck; `stop` does the same cleanup
automatically.

## Troubleshooting

When anything misbehaves, the first call is **`doctor`**:

```bash
node --conditions=react-server skills/test-frontend/run.ts doctor
```

It prints a JSON report with a pass/fail line per precondition (test-mode flag,
project-local `tsx`, Playwright package, Chromium binary, orphan pid/port files)
and a `fix` suggestion for each failing check. Exit code is `0` when the
environment is fully usable.

Other common failure modes:

- **"driver did not become ready within 120s"** — the error message now includes
  the tail of `.driver.log`. The most common cause is Playwright failing to
  launch Chromium (missing OS libs on fresh Linux containers). Run
  `cd skills/test-frontend && npx playwright install-deps` to install the system
  deps (requires `sudo` on most distros).
- **Silent driver exits** — always tail `.driver.log`:
  ```bash
  node --conditions=react-server skills/test-frontend/run.ts logs --tail 80
  ```
- **Port 3000 already in use by something unrelated** — pass `--port` to
  `start`, or stop the conflicting process. `status` shows whether the port is
  reachable and who owns it via the pid file.
- **Stale pid/port files after a force-kill** — `doctor` flags inconsistent
  state. Either run `stop --all` or delete `.driver.pid` / `.driver.port` /
  `.server.pid` / `.server.port` under `skills/test-frontend/`.
- **First run is slow** — Playwright + Chromium install takes ~1–2 minutes.
  Subsequent runs are cached. The skill's `package.json` and `node_modules/`
  live inside the skill folder; they do not touch the project's root deps.

## Interop with other skills

- `test-routes` — starts its own dev server at
  `skills/test-routes/.server.port`. This skill will **reuse** that port if it
  is reachable, avoiding a duplicate server. Either skill can start the server;
  either can stop it (`stop --all`).
- `test-db-queries` — use it to set up or clean state before/after a flow:
  ```bash
  node --conditions=react-server skills/test-db-queries/run.ts 'DELETE user WHERE email = "test@foo"'
  node --conditions=react-server skills/test-frontend/run.ts goto /register
  # … drive the registration form …
  node --conditions=react-server skills/test-db-queries/run.ts 'SELECT * FROM user WHERE email = "test@foo"'
  ```

## Rules

- **Refuses to run** unless `database.json` carries `"test": true`.
- **First run installs Playwright + Chromium** into
  `skills/test-frontend/node_modules` (~1–2 min). The project's `package.json`
  is never modified.
- **Uses Node built-ins via `node:*` specifiers** (`node:fs`, `node:path`,
  `node:child_process`, `node:http`, `node:timers/promises`, `node:module`,
  `node:process`) so the shape is runtime-agnostic — the same style Deno
  accepts.
- **One browser, one context, one tab at a time by default.** `new-page` adds
  tabs; the most recently opened is always the active one.
- **Cookies and localStorage persist across commands** until the driver stops or
  `reset` is called. That is the whole point — the skill is designed to be
  composed command-by-command.
- **Never seeds or mutates data on its own** beyond what the browser flow
  produces. For explicit setup/teardown, use `test-db-queries`.
- **Credentials are not masked.** Any token / password you type via `fill` or
  `type` ends up in `.driver.log`. Delete the log or `stop` the driver when you
  are done.

## After execution — kill Next.js servers

This skill auto-starts the Next.js dev server. When you are done testing,
explicitly kill all running Next.js servers:

```bash
pkill -f "next dev" && pkill -f "next start"
```
