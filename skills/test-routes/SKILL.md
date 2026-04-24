---
name: test-routes
description: Use whenever the user wants to exercise the project's HTTP API — hit a route under `/api/**`, inspect the raw response, reproduce an auth/tenant flow, or verify a route change end-to-end. Trigger on phrases like "call POST /api/...", "test this route", "hit the login endpoint", "verify the billing API", "what does GET /api/core/systems return", "curl the route". The skill spins up the Next.js dev server, logs in as the seeded superuser (`core@admin.com` / `core1234` from `001_superuser.ts`), attaches the bearer automatically, and prints the raw `{ status, statusText, ok, url, body }` as JSON so responses can be analysed directly. It refuses to start unless `database.json` explicitly carries `"test": true`.
---

# Test Routes

Exercise the project's API routes against the configured test database and print
the **raw** status + body so responses can be analysed directly.

The skill is intentionally tiny and deterministic: one script, three verbs
(`server` / `login` / `request`), no hidden state beyond a pid file and an
optional cached superuser JWT. Output is always JSON (unless you pass `--raw`)
so downstream tools can parse it.

## When to use

- Check what a route returns end-to-end — status code, headers (optional), body
  shape.
- Reproduce an authenticated flow against the real middleware pipeline
  (`withRateLimit`, `withAuth`, `withPlanAccess`, `withEntityLimit`).
- Verify that a newly added / edited route under `app/api/**` behaves as
  intended, with the seeded superuser or an explicit bearer token.
- Debug tenant-aware behaviour — pass `--token` with a token issued for a
  specific tenant to emulate any actor (user session, API token, connected app).

## When NOT to use

- Production traffic. The skill refuses to start unless `database.json` has
  `"test": true`.
- Unit-testing a pure query or schema change. Use **test-db-queries** for raw
  SurrealQL.
- Load testing. This is a single-shot runner, not a benchmark tool.

## Prerequisites

1. Open `database.json` and confirm the `url` / `user` / `pass` / `namespace` /
   `database` point at a **test** database — never production.
2. Set `"test": true` in `database.json`. The skill hard-exits with a loud error
   message otherwise.
3. When finished, flip `"test"` back to `false` so future runs refuse until
   someone re-confirms.
4. The Node runtime must have `npm run dev` available (standard project
   scripts). No extra tooling is needed — `fetch`, `spawn`, and `node:fs` are
   all built-in.

## Typical session

```bash
# 1. Start the dev server in the background.
tsx skills/test-routes/run.ts server start
#    (on a cold repo this takes ~30–60s — the skill waits for readiness)

# 2. Cache the seeded superuser JWT (optional but convenient).
tsx skills/test-routes/run.ts login

# 3. Call any route. Output is JSON: { status, statusText, ok, url, body }.
tsx skills/test-routes/run.ts GET  /api/public/front-core
tsx skills/test-routes/run.ts GET  /api/core/systems --as-superuser
tsx skills/test-routes/run.ts POST /api/core/systems \
    --as-superuser \
    --body '{"name":"Foo","slug":"foo"}'

# 4. Check the dev server log when a call misbehaves.
tsx skills/test-routes/run.ts server logs --tail 80

# 5. Stop the server cleanly.
tsx skills/test-routes/run.ts server stop
```

Any command where the first argument is an HTTP method (`GET`, `POST`, `PUT`,
`PATCH`, `DELETE`, `OPTIONS`, `HEAD`) is treated as an implicit `request …`, so
you can skip the word `request` in day-to-day use.

## Subcommands

### `server start [--port N] [--timeout N] [--foreground]`

Starts `npm run dev` detached, redirecting stdout/stderr to
`skills/test-routes/.server.log`. Records the PID in `.server.pid` and the port
in `.server.port`. Waits for the server to answer `GET /api/public/front-core`
before returning. Re-running `start` while a healthy server is already up is a
no-op (the skill reports `alreadyRunning: true`).

- `--port <N>` — bind a non-default port (default `3000`).
- `--timeout <ms>` — how long to wait for readiness (default `120000`).
- `--foreground` — run the server in the foreground (blocks, Ctrl-C to stop).
  Useful when you want to watch logs interactively.

### `server stop`

Terminates the detached server (SIGTERM, then SIGKILL if it refuses within 10
s). Clears `.server.pid`.

### `server status`

Prints JSON with `pid`, `pidAlive`, `baseUrl`, `reachable`, `logFile`. Exits `0`
when reachable, `1` otherwise — handy for scripts.

### `server logs [--tail N]`

Prints the last `N` lines of `.server.log` (default 50). Use `--all` for the
entire log.

### `login [--email X] [--password Y] [--no-persist]`

Performs `POST /api/auth/login` with the seeded superuser credentials and prints
the resulting `systemToken` + `user`. Caches the token in
`skills/test-routes/.superuser-token` so subsequent `--as-superuser` calls skip
the round-trip. `--no-persist` prints the token without caching it.

The defaults (`core@admin.com` / `core1234`) match the seed file
[`server/db/seeds/001_superuser.ts`](../../server/db/seeds/001_superuser.ts) —
if you changed the seeded password, pass `--password` explicitly.

### `request <METHOD> <PATH> [BODY-JSON]`

The workhorse. Sends the HTTP request and prints a JSON envelope:

```json
{
  "status": 200,
  "statusText": "OK",
  "ok": true,
  "url": "http://localhost:3000/api/core/systems",
  "body": { "success": true, "data": [ ... ] }
}
```

`body` is parsed as JSON when possible; otherwise the raw string is returned.
Exit code is `0` when `ok` is true (2xx/3xx), `1` otherwise. Use `--raw` to
print the response body verbatim with no wrapping JSON.

Flags:

| Flag                           | Meaning                                                            |
| ------------------------------ | ------------------------------------------------------------------ |
| `--body <json>` / `-b <json>`  | JSON body (overrides any positional body arg).                     |
| `--body-file <path>`           | Read body from a file.                                             |
| `-H` / `--header 'Key: Value'` | Add a request header (repeatable).                                 |
| `--as-superuser`               | Login as the seeded superuser, attach `Bearer` token.              |
| `--token <jwt>`                | Attach an explicit bearer (use for non-superuser tests).           |
| `--base-url <url>`             | Override base URL (default: `.server.port` or `:3000`).            |
| `--include-response-headers`   | Include response headers in the JSON envelope.                     |
| `--raw`                        | Print body verbatim; skip the JSON envelope.                       |
| `--compact`                    | Emit minified JSON (default is pretty-printed).                    |
| `--follow-redirects`           | Follow 3xx redirects (default: `manual`).                          |
| `--superuser-email <addr>`     | Override the seeded email used by `--as-superuser`.                |
| `--superuser-password <pwd>`   | Override the seeded password used by `--as-superuser`.             |
| `--form key=value`             | Text field for `multipart/form-data` (repeatable).                 |
| `--form-file name.ext`         | Random-bytes file for multipart (repeatable). Always key `"file"`. |
| `--form-real-file path`        | Disk file for multipart (repeatable). Always key `"file"`.         |
| `--file-size <N>`              | Size for `--form-file` (default `1024`; suffix K/M).               |

`Content-Type: application/json` is set automatically whenever a body is
supplied and you haven't added your own `content-type` header.

### Form submissions & file uploads

When any `--form` or `--form-file` flag is present, the request body is sent as
`multipart/form-data` instead of JSON. This lets you test any route that expects
FormData — file uploads, form submissions, etc. — without manually constructing
the multipart body.

| Flag                       | Meaning                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------- |
| `--form key=value`         | Add a text field. Repeatable. The value is sent as-is.                              |
| `--form-file filename.ext` | Generate a file with **random bytes** and attach it under key `"file"`. Repeatable. |
| `--form-real-file path`    | Attach an existing file from disk under key `"file"`. Repeatable.                   |
| `--file-size <N>`          | Size in bytes for `--form-file` (default: `1024`). Suffixes: `K` = KB, `M` = MB.    |

**Random file generation** (`--form-file`): the skill generates `N` random bytes
in memory and attaches them as a Blob with `application/octet-stream` mime type.
You control the size with `--file-size` (place it **before** `--form-file` in
the command line). The filename you specify is sent as-is — the extension is
cosmetic (the server reads the actual content).

**Real file from disk** (`--form-real-file`): reads the file at the given path
and attaches it with the filename derived from the path.

When form flags are present, the `Content-Type` header is **not** set manually —
`fetch()` sets it automatically with the correct multipart boundary. Do not pass
`-H 'Content-Type: ...'` when using form flags.

#### Examples

```bash
# Simple form submission (text fields only)
tsx skills/test-routes/run.ts POST /api/some-form \
    --form "name=Alice" --form "email=alice@test.com" --as-superuser

# File upload with a 1 KB random file (default size)
tsx skills/test-routes/run.ts POST /api/files/upload \
    --form "systemSlug=grex-id" \
    --form 'category=["avatars"]' \
    --form "fileUuid=test-uuid-001" \
    --form-file photo.png --as-superuser

# Upload with a 2 MB random file
tsx skills/test-routes/run.ts POST /api/files/upload \
    --form "systemSlug=grex-id" --form 'category=["docs"]' \
    --form "fileUuid=test-uuid-002" --form-file report.pdf \
    --file-size 2M --as-superuser

# Upload a real file from disk
tsx skills/test-routes/run.ts POST /api/files/upload \
    --form "systemSlug=grex-id" --form 'category=["docs"]' \
    --form "fileUuid=test-uuid-003" \
    --form-real-file /tmp/data.csv --as-superuser
```

## How `--as-superuser` works

1. Reads `skills/test-routes/.superuser-token` (cached from a prior `login`).
2. If the cache is missing, performs `POST /api/auth/login` with the seeded
   superuser credentials and writes the new token to the cache.
3. Attaches `Authorization: Bearer <token>`.
4. If the first response is `401` (token likely expired), retries once after a
   fresh login.

This is deliberately the only automatic auth path — for any other tenant
(non-superuser user, API token, connected-app token), pass `--token <jwt>`
explicitly.

## Creating additional tenants / users

The skill itself never seeds or mutates data. Compose it with
**test-db-queries** when a test needs a fresh tenant:

```bash
# Create a non-superuser via the public register route
tsx skills/test-routes/run.ts POST /api/auth/register \
    --body '{"password":"x","name":"Alice","channels":[{"type":"email","value":"alice@test.com"}],"termsAccepted":true}'

# Or create rows directly with the DB skill and then hit a route with the
# resulting ids. `test-db-queries` is the right tool for setup/teardown.
tsx skills/test-db-queries/run.ts 'SELECT id FROM user WHERE roles CONTAINS "admin"'
```

Tokens issued via core admin routes (`POST /api/tokens`,
`POST /api/auth/oauth/authorize`) are returned once in the response body —
capture them with `--raw` and re-use via `--token`.

## Output format

Default output is pretty-printed JSON on stdout:

```json
{
  "status": 200,
  "statusText": "OK",
  "ok": true,
  "url": "http://localhost:3000/api/core/systems",
  "body": { "success": true, "data": [ … ] }
}
```

With `--include-response-headers`, an additional `headers` field is emitted.
With `--raw`, the body is written verbatim (useful for HTML, streamed files, or
third-party tooling that expects plain JSON).

Errors from the skill itself (server not reachable, cannot parse body, etc.) go
to **stderr** prefixed with `[test-routes]` and exit non-zero; the HTTP response
is always written to **stdout**. This makes it easy to capture just the
response: `tsx skills/test-routes/run.ts GET /foo 2>/dev/null`.

## State files

All state lives under `skills/test-routes/` and can be deleted freely:

| File               | Purpose                                          |
| ------------------ | ------------------------------------------------ |
| `.server.pid`      | PID of the detached `npm run dev` process.       |
| `.server.port`     | Port the server is bound to.                     |
| `.server.log`      | stdout + stderr of the dev server since start.   |
| `.superuser-token` | Cached superuser JWT (rewritten on every login). |

## Rules

- **Refuses to run** unless `database.json` carries `"test": true`.
- **Uses Node built-ins via `node:*` specifiers** (`node:fs`, `node:path`,
  `node:child_process`, `node:timers/promises`, `node:process`) so the shape is
  runtime-agnostic — the same style Deno accepts.
- **Never seeds or mutates data on its own.** Setup/teardown is the caller's job
  (typically via the `test-db-queries` skill or an explicit API call).
- **Does not capture or mask secrets.** Cached superuser tokens live in
  plaintext under `skills/test-routes/`; delete the directory when you are done,
  and never commit it.
