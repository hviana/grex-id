---
name: test-db-queries
description: Use whenever the user wants to run an ad-hoc SurrealDB query against the configured test database — inspect rows, debug a query from server/db/queries/, insert/update/delete test data, or confirm the shape of a result. Trigger on phrases like "query the DB", "SELECT from user", "run this SurrealQL", "check what's in the database", "test this query", "dump table X". The skill runs raw CRUD (SELECT / CREATE / UPDATE / UPSERT / DELETE / INSERT / RELATE, plus LET / IF / FOR / BEGIN-COMMIT). Schema-changing statements (DEFINE, REMOVE, ALTER) are blocked — those belong in migrations. The skill refuses to start unless `database.json` explicitly carries `"test": true`.
---

# Test DB Queries

Run ad-hoc SurrealQL against the project's database and print the raw result.
Reuses the shared connection (`server/db/connection.ts`) and the credentials in
`database.json`.

## When to use

- Sanity-check a query you wrote under `server/db/queries/` without wiring a
  route.
- Inspect the state of a table after a migration, a seed, or a manual flow.
- Seed / clean / edit test data during local development.
- Reproduce a bug with a specific record id.

## When NOT to use

- Schema changes. DDL (`DEFINE`, `REMOVE`, `ALTER`) is blocked — the skill only
  runs CRUD. Schema changes are out of scope for this skill.
- Anything against a production database — the skill refuses to start unless
  `database.json` has `"test": true`.

## Prerequisites

1. Open `database.json` and confirm the `url` / `user` / `pass` / `namespace` /
   `database` point at a **test** database — never production.
2. Set `"test": true` in `database.json`. The skill will hard-exit with a loud
   error message otherwise.
3. When finished, flip `"test"` back to `false` so future runs refuse until
   someone re-confirms.

## Usage

All forms below are equivalent — pick whichever is easiest.

```bash
# Inline query, positional form
node --conditions=react-server skills/test-db-queries/run.ts "SELECT * FROM user LIMIT 5"

# Inline query with bindings (JSON string)
node --conditions=react-server skills/test-db-queries/run.ts \
  -q "SELECT * FROM user WHERE id = type::thing('user', $key)" \
  -b '{"key":"abc123"}'

# Query from a file
node --conditions=react-server skills/test-db-queries/run.ts -f /tmp/debug.surql

# Query from a file plus bindings from a JSON file
node --conditions=react-server skills/test-db-queries/run.ts -f /tmp/debug.surql --bindings-file /tmp/vars.json

# Query via stdin (handy for heredocs)
node --conditions=react-server skills/test-db-queries/run.ts --stdin <<'SURQL'
SELECT id, profile.name AS name
FROM user
FETCH profile
LIMIT 10;
SURQL
```

Flags:

| Flag                      | Meaning                                         |
| ------------------------- | ----------------------------------------------- |
| `-q`, `--query <surql>`   | Inline SurrealQL string.                        |
| `-f`, `--file <path>`     | Read SurrealQL from a file.                     |
| `--stdin`                 | Read SurrealQL from stdin.                      |
| `-b`, `--bindings <json>` | Bindings object as a JSON string.               |
| `--bindings-file <path>`  | Bindings object from a JSON file.               |
| `--compact`               | Emit minified JSON (default is pretty-printed). |
| `-h`, `--help`            | Show built-in help.                             |

## Output

The runner prints **the raw `db.query(...)` return value** as JSON on stdout.
SurrealDB returns an array where each entry is the result of one statement in
the query, in order. For example:

```surql
LET $u = CREATE user SET passwordHash = "x", profile = NONE, channels = [], roles = [];
SELECT * FROM $u[0].id;
```

prints something like:

```json
[
  [{ "id": "user:xyz", "passwordHash": "x", "channels": [], "roles": [] }],
  [{ "id": "user:xyz", "passwordHash": "x", "channels": [], "roles": [] }]
]
```

Record ids returned by the driver are serialized as `"table:id"` strings so they
can be copied directly into follow-up queries.

Errors from the driver are printed to stderr verbatim and the process exits with
a non-zero code.

## Binding record ids

SurrealDB fields typed `record<table>` will not match a plain `"user:abc"`
string binding — the driver expects a record-id object. Two safe options:

- Build the id inline with `type::record` and bind the plain string:
  ```surql
  SELECT * FROM type::record("user", $key);
  ```
- Or use `LET` + `type::record`:
  ```surql
  LET $id = type::record($table, $key);
  SELECT * FROM $id;
  ```

Both work through the skill without any extra machinery.

## Syntax warnings

Before executing, the runner checks for common SurrealDB 3.0 foot-guns and
prints warnings to stderr. These are **non-blocking** — the query still runs.

| Code                          | Trigger                                                   |
| ----------------------------- | --------------------------------------------------------- |
| `W_BARE_VALUE`                | `value` used as a bare SELECT column (reserved keyword)   |
| `W_FETCH_AFTER_LIMIT`         | FETCH appears after LIMIT (wrong order)                   |
| `W_NESTED_IF_UNPARENTHESIZED` | Nested IF without parentheses (SurrealDB 3.0 requirement) |

Fix the query to eliminate the warning, or ignore it if the warning is a false
positive for your specific case.

## Query normalization

All queries are normalized before execution:

- UTF-8 BOM is stripped.
- CRLF (`\r\n`) is normalized to LF.
- Trailing whitespace per line is stripped.
- Excessive blank lines are collapsed.

This prevents encoding artifacts from silently corrupting SurrealDB queries
(especially common with heredoc input and Windows editors).

## Rules

- **Refuses to run** unless `database.json` has `"test": true`.
- **Blocks DDL.** `DEFINE`, `REMOVE`, `ALTER` anywhere in the query string →
  refused. Migrations only.
- **Uses Node built-ins via `node:*` specifiers** (`node:fs`, `node:path`) so
  the script is runtime-agnostic — same shape Deno accepts.
- **Reuses** `getDb()` / `closeDb()` from `server/db/connection.ts`. Do not open
  your own connection; just invoke the runner.
