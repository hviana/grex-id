---
name: test-events
description: Use whenever the user wants to debug or verify the project's event queue — any handler, not just communications. Trigger on phrases like "did the event fire", "check the queue", "wait for the <handler> event", "inspect the payload of <event>", "did process_payment run", "what did auto_recharge pass along", "grab the verification link and click it", "was a verification_request created", "test the confirmation flow", "check delivery status", "any dead letters lately", "inspect the last <handler> payload". The skill polls `delivery` + `queue_event` + `verification_request` rows, waits the reasonable time for the worker to pick them up, and extracts the full payload so the caller can assert whatever they need (recipients, confirmationLink, transactionId, subscriptionId, resourceKey, or any custom field a subsystem / framework handler puts there). For human-confirmation flows it can also delegate to `test-frontend` to actually click the link. It works even when the underlying channel or provider (email, SMS, push, payment gateway) has no real credentials configured — all validation is done on the queue rows, not on external providers. Refuses to start unless `database.json` carries `"test": true`.
---

# Test Events

Exercise **any** handler in the project's event queue end-to-end against the
configured test database. The skill reads the `delivery`, `queue_event`, and
`verification_request` rows that the application publishes, waits for the worker
loop to pick them up, and surfaces the full payload so the caller can assert
whatever matters for the event they care about — a recipient list on
`send_email`, a `transactionId` on `process_payment`, a custom field a subsystem
handler put into `queue_event.payload`, anything.

**Every event handler is in scope — not just communications.** Examples of
handlers you can wait on and inspect today:

- `send_email` / `send_sms` (and any framework-registered channel handler like
  `send_push`, `send_phone`) — communication dispatch via
  `dispatchCommunication`.
- `process_payment` — synchronous payment attempts (recurring billing, credit
  purchases, retries).
- `resolve_async_payment` — deferred-payment webhook resolution.
- `auto_recharge` — auto top-up credit flow.
- Any subsystem handler registered via `systems/<slug>/register.ts`
  (`registerHandler(…)`), e.g. a subsystem's `grexid_process_detection`.
- Any framework handler registered via `frameworks/<name>/register.ts`.

The skill does not care which handler it is. You pass `--handler <name>`,
`--event-name <name>`, and/or a `--payload-contains` JSON filter, and it waits
for a matching `delivery` row and prints it.

This is the single most important thing to understand about the skill: **you do
not need working external credentials (SMTP, SMS provider, payment gateway, push
service, any third party) to test an event flow**. The application always goes
publisher → `queue_event` → `delivery` → handler → (optional external call).
Reading the delivery and its payload is enough to verify every step up to the
external call. For human-confirmation flows specifically, the
`verification_request` row carries the one-time token the user would click on in
their inbox — so you can click it yourself with `test-frontend`.

## When to use

- Verify that an action (register, forgot-password, subscribe, purchase_credits,
  retry_payment, a custom subsystem action, …) actually **published** an event —
  and that the payload shape is what you expected.
- Inspect the payload of any handler: recipients, transactionId, subscriptionId,
  resourceKey, continuityData, or any custom field a subsystem / framework
  added.
- Confirm that a delivery reached `status = done` (handler ran) or `dead` (max
  attempts exhausted) — proof that the worker loop picked it up.
- Debug a failing handler: filter by `--status dead` and read `lastError` on the
  matched deliveries.
- For communication events specifically: extract the `confirmationLink` from a
  fresh `verification_request` so the test can drive `/verify?token=…` to
  completion.
- Seed-and-replay a flow: publish → wait → inspect → (optionally) click.

## When NOT to use

- Production traffic. The skill refuses to start unless `database.json` carries
  `"test": true`.
- Making a real external call (send an email, charge a card, push a
  notification) — the skill does not provision provider credentials and never
  tries to.
- Unit-testing a pure query. Use `test-db-queries` for raw SurrealQL.
- Driving UI flows by themselves. Use `test-frontend` for clicks/forms; pair it
  with this skill when an action requires a confirmation link.

## Prerequisites

1. Open `database.json` and confirm the `url` / `user` / `pass` / `namespace` /
   `database` point at a **test** database — never production.
2. Set `"test": true` in `database.json`. The skill hard-exits with a loud error
   message otherwise.
3. When finished, flip `"test"` back to `false` so future runs refuse until
   someone re-confirms.
4. That's it. The skill reuses the project's own dependencies (the shared
   `server/db/connection.ts` SurrealDB client); no extra install step.

## How events flow in this project (one paragraph)

Any publisher — a route handler, another event handler, a job — calls
`publish(<name>, <payload>)`. That writes one row to `queue_event` and one row
to `delivery` per registered handler for that name, with `status = "pending"`.
The worker loop (started by `instrumentation.ts` when the dev server boots)
claims pending rows, sets `status = "processing"`, runs the handler, and sets
`status = "done"` on success or `status = "pending"` with backoff on retryable
failures. After `maxAttempts`, rows move to `status = "dead"` and `lastError` is
stored on the delivery. For human-confirmation flows specifically, the
publishing path additionally creates a `verification_request` row with a
one-time token; clicking the link calls `POST /api/auth/verify` which flips
`usedAt = time::now()` and performs the actual state change. This skill surfaces
all of those rows as one JSON envelope per verb — the communication case is just
one common instance.

## Typical sessions

### Debug any event — the generic flow

```bash
# 1. Trigger whatever action publishes the event you care about — could be
#    an HTTP call, a DB write, a cron tick, anything.
tsx skills/test-routes/run.ts POST /api/billing \
  --as-superuser \
  --body '{"action":"purchase_credits","companyId":"company:...","systemId":"system:...","amount":1000,"paymentMethodId":"payment_method:..."}'

# 2. Wait for the delivery row matching the handler you want. Any filter that
#    makes the match unique works: --handler, --event-name, --payload-contains,
#    --since. On match, the full payload is printed.
tsx skills/test-events/run.ts wait \
  --handler process_payment \
  --payload-contains '{"kind":"credits"}' \
  --timeout 30000

# 3. Inspect later if needed — or list all recent deliveries for a handler.
tsx skills/test-events/run.ts list --handler process_payment --since 10m
tsx skills/test-events/run.ts stats --minutes 30
```

For dead-letter debugging:

```bash
tsx skills/test-events/run.ts list --status dead --since 1h
#  → includes `lastError` on every row so you can see why the handler failed
```

### Communication + confirmation (the specific case)

```bash
# 1. Kick off an action that publishes a communication (via any path).
tsx skills/test-routes/run.ts POST /api/auth/register \
  --body '{"password":"x","name":"Alice","channels":[{"type":"email","value":"alice@test.com"}],"termsAccepted":true}'

# 2. Wait for the delivery row that was published by `dispatchCommunication(…)`.
#    It picks the first registered channel (e.g. send_email) and publishes
#    directly. Filters: handler=send_email (or send_sms, …),
#    actionKey=auth.action.register. Blocks until the worker processes it,
#    up to --timeout ms.
tsx skills/test-events/run.ts wait \
  --handler send_email \
  --action-key auth.action.register \
  --timeout 30000

# 3. Grab the confirmation link from the verification_request row.
#    (Either pull it from the payload in step 2, or ask the verification
#    table directly — whichever is easier.)
tsx skills/test-events/run.ts verification link \
  --action-key auth.action.register \
  --owner-id user:<id>

# 4. Drive the link in a real browser. (Delegates to test-frontend.)
tsx skills/test-events/run.ts verification confirm \
  --action-key auth.action.register \
  --owner-id user:<id>

# 5. Inspect what actually happened across all handlers.
tsx skills/test-events/run.ts stats --minutes 5

# 6. Optional: clean up old rows when iterating.
tsx skills/test-events/run.ts clear --older-than-minutes 15
```

Output is always a JSON envelope on stdout. Errors from the skill go to stderr
prefixed with `[test-events]` and exit non-zero.

## Subcommands

### `list`

List recent deliveries (the queue rows the workers actually pull from).

| Flag                                       | Meaning                                                   |
| ------------------------------------------ | --------------------------------------------------------- |
| `--handler NAME`                           | Filter by handler (e.g. `send_email`, `process_payment`). |
| `--status pending\|processing\|done\|dead` | Filter by status.                                         |
| `--event-name NAME`                        | Filter by the underlying `queue_event.name`.              |
| `--since <iso\|Ns\|Nm\|Nh>`                | Lower time bound (default: `5m` ago).                     |
| `--limit N`                                | Default 50, cap 500.                                      |
| `--compact`                                | Single-line JSON.                                         |

Each row includes the resolved event name + the full payload. For communication
events that means `recipients` / `template` / `templateData` / `channels`; for
any other handler it's whatever the publisher passed in — the skill prints the
payload verbatim.

### `wait`

Block until a delivery matches all the filters below, then print it. When the
matched delivery is a communication (`templateData` is present) the skill also
surfaces `confirmationLink` and `templateData` at the top level for convenience;
for any other handler those fields are simply `null` and the full payload is in
`matched.payload`. Returns non-zero when the timeout elapses without a match.

| Flag                                                    | Meaning                                                                                                                                                        |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--handler NAME`                                        | Handler name. Works for every registered handler — `send_email`, `process_payment`, `auto_recharge`, subsystem / framework names, whatever.                    |
| `--event-name NAME`                                     | Underlying `queue_event.name`.                                                                                                                                 |
| `--recipient user:…\|lead:…`                            | Communication convenience: require `payload.recipients` to contain this id.                                                                                    |
| `--action-key auth.action.register`                     | Communication convenience: require `payload.templateData.actionKey` to equal this.                                                                             |
| `--status pending\|processing\|done\|dead`              | Require the delivery to be in this status. Omit for "any".                                                                                                     |
| `--payload-contains '{"kind":"credits","amount":1000}'` | **The generic filter — works for any handler.** Deep-equality match against payload. Strings match by substring inclusion OR equality. Nested objects descend. |
| `--since <dur>`                                         | Lower time bound (default: `2m` ago). Use this to ignore older noise when the test DB isn't cleaned.                                                           |
| `--timeout <ms>`                                        | Total wait time (default: `60000`).                                                                                                                            |
| `--poll <ms>`                                           | Poll interval (default: `500`).                                                                                                                                |

For non-communication handlers, combine `--handler` with `--payload-contains` to
uniquely identify the delivery you want:

```bash
# Wait for the process_payment call that targets a specific subscription.
tsx skills/test-events/run.ts wait \
  --handler process_payment \
  --payload-contains '{"subscriptionId":"subscription:abc","kind":"recurring"}' \
  --status done \
  --timeout 45000

# Wait for an arbitrary subsystem handler.
tsx skills/test-events/run.ts wait \
  --handler grexid_process_detection \
  --payload-contains '{"leadId":"lead:xyz"}' \
  --timeout 60000
```

On the first `wait` call, the skill ensures a dev server is running (the worker
loop lives inside the dev server). If nothing is reachable, it starts one via
the `test-routes` skill so they share a single server.

### `stats`

Bucket recent deliveries by status and handler. Quick view of what the queue did
in the last N minutes.

| Flag          | Meaning                      |
| ------------- | ---------------------------- |
| `--minutes N` | Time window (default: `15`). |

### `clear`

Delete old `queue_event`, `delivery`, and `verification_request` rows in a
single batched query. Handy when iterating — old rows accumulate and can confuse
`wait` unless you pass `--since`.

| Flag                     | Meaning                                           |
| ------------------------ | ------------------------------------------------- |
| `--older-than-minutes N` | Delete rows older than N minutes (default: `60`). |

### `verification <sub>`

Inspect the `verification_request` table — the backing row for every
human-confirmation flow.

- `verification list` — list recent rows. Filters: `--action-key`, `--owner-id`,
  `--token`, `--include-used`, `--limit`.
- `verification wait` — block until a row matches the filters (same as above
  plus `--timeout`, `--poll`, `--since`). Prints the row with its resolved
  confirmation URL (`<app.baseUrl>/verify?token=…`).
- `verification link` — shortcut that returns just the most recent matching
  row's confirmation URL.
- `verification confirm` — waits for a matching row, resolves its confirmation
  URL, and drives it in a real browser via the `test-frontend` skill. This is
  the one-call shortcut for "click the email link".

### `confirm-link <url>`

Open any confirmation URL via `test-frontend`. Useful when you already have the
link (e.g. from a `wait` payload) and just need it clicked. Works with external
URLs too — pair this with the `test-frontend goto` extension so a link that
points at `https://provider.example.com/callback?…` is also clickable.

## Output format

Every command prints a JSON envelope on stdout. The `matched.payload` shape
varies by handler — the skill always surfaces it verbatim so you can assert
whatever the publisher put there.

Example: a `send_email` delivery (communication event, so `confirmationLink` and
`templateData` are additionally surfaced at the top level):

```json
{
  "ok": true,
  "matched": {
    "id": "delivery:abc",
    "handler": "send_email",
    "status": "done",
    "eventId": "queue_event:xyz",
    "eventName": "send_email",
    "payload": {
      "channel": "email",
      "channelFallback": [],
      "recipients": ["user:123"],
      "template": "human-confirmation",
      "templateData": {
        "actionKey": "auth.action.register",
        "confirmationLink": "http://localhost:3000/verify?token=…",
        "occurredAt": "2026-04-22T00:00:00.000Z",
        "locale": "pt-BR",
        "systemSlug": "core"
      }
    },
    "attempts": 1,
    "maxAttempts": 5,
    "availableAt": "…",
    "startedAt": "…",
    "finishedAt": "…",
    "createdAt": "…"
  },
  "confirmationLink": "http://localhost:3000/verify?token=…",
  "templateData": { "actionKey": "auth.action.register", … },
  "waitedMs": 1237
}
```

Example: a non-communication event (e.g. `process_payment`). The payload is
whatever the publisher passed in; `confirmationLink` and `templateData` are
`null` because the event doesn't carry them:

```json
{
  "ok": true,
  "matched": {
    "id": "delivery:def",
    "handler": "process_payment",
    "status": "done",
    "eventId": "queue_event:ghi",
    "eventName": "process_payment",
    "payload": {
      "subscriptionId": "subscription:abc",
      "kind": "credits",
      "amount": 1000,
      "currency": "BRL",
      "paymentMethodId": "payment_method:xyz",
      "creditPurchaseId": "credit_purchase:mno"
    },
    "attempts": 1,
    "maxAttempts": 5,
    "finishedAt": "…",
    "createdAt": "…"
  },
  "confirmationLink": null,
  "templateData": null,
  "waitedMs": 842
}
```

Record ids are flattened to `"table:id"` strings so they can be copied directly
into `test-db-queries` / `test-routes` / `test-events` follow-up calls.

## How waiting works (and why it takes a few seconds)

Event publishing writes a row to `delivery` synchronously. Event handling is
asynchronous — it only runs while the worker loop inside the dev server is up.
So after you publish, the delivery sits in `status = "pending"` until:

1. The worker's next cycle picks it up (default poll: hundreds of ms).
2. The handler runs — whatever it happens to do (template render + provider call
   for communications, gateway charge for `process_payment`, a custom subsystem
   step, …).
3. The handler returns and the delivery flips to `status = "done"` (or fails and
   backs off; after `maxAttempts` it moves to `status = "dead"` with `lastError`
   set).

`wait` polls every `--poll ms` (default 500) until a row matches all the
filters. Set `--timeout` generously — on a cold dev server the first cycle can
take a few seconds while Next.js compiles. When nothing matches, `wait` exits
non-zero with `ok: false` so upstream tests fail loudly.

If you only care about "did the event get **published**", pass
`--status pending` (or omit `--status`) and you'll return as soon as the row
exists. If you care about "did the handler **run** successfully", pass
`--status done`.

## Interop with other skills

- **test-routes** — use it to fire the action that publishes the event, then
  hand off to this skill. The two skills share a dev server (this skill spawns
  one via `test-routes` when nothing is reachable).
- **test-frontend** — `verification confirm` and `confirm-link` delegate the
  final "click" step to the frontend skill so the `/verify` handler executes in
  a real browser with real cookies. The frontend skill supports external URLs
  too (see its docs for `goto`).
- **test-db-queries** — use it to set up state (create a user, plant a
  pre-existing channel) before triggering the flow, or to confirm a downstream
  side effect after `verification confirm` (e.g. the user now has
  `user.channels[0].verified = true`).

Example chained flow:

```bash
# Setup a lead registration, then wait for the lead-register confirmation email
tsx skills/test-routes/run.ts POST /api/leads/public \
  --body '{"name":"Bob","channels":[{"type":"email","value":"bob@test.com"}],"systemSlug":"grex-id","companyIds":["company:acme"],"termsAccepted":true,"botToken":"stub"}'

tsx skills/test-events/run.ts verification confirm \
  --action-key auth.action.leadRegister \
  --timeout 45000

tsx skills/test-db-queries/run.ts \
  "SELECT id, channels.*.{type, value, verified} FROM lead WHERE name = 'Bob'"
```

## Rules

- **Refuses to run** unless `database.json` carries `"test": true`.
- **Uses Node built-ins via `node:*` specifiers** (`node:fs`, `node:path`,
  `node:child_process`, `node:timers/promises`, `node:process`) so the shape is
  runtime-agnostic — the same style Deno accepts.
- **Reuses `getDb()` / `closeDb()`** from `server/db/connection.ts`. No second
  SurrealDB connection is opened.
- **Auto-starts the dev server** (via `test-routes`) on any command that needs
  the worker loop (`wait`, `verification wait`, `verification confirm`). If
  `test-routes` already started a server, this skill reuses it. No duplicate
  processes.
- **Never mutates production data.** The `"test": true` guard is the single
  enforcement point — there is no override flag.
- **`clear` is destructive but scoped.** It deletes rows older than N minutes
  across `queue_event`, `delivery`, and `verification_request`. It never touches
  other tables.
