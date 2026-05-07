import "server-only";

import dbConfig from "../../database.json" with { type: "json" };

const DB_URL = dbConfig.url;
const DB_USER = dbConfig.user;
const DB_PASS = dbConfig.pass;
const DB_NAMESPACE = dbConfig.namespace;
const DB_DATABASE = dbConfig.database;

type JsonObject = Record<string, unknown>;

type SqlQueryStatement = {
  status?: string;
  result?: unknown;
  time?: string;
  detail?: string;
  type?: string | null;
};

type PreparedSqlQuery = {
  sql: string;
  injectedStatementCount: number;
};

type SigninAttempt = {
  kind:
    | "database-uppercase"
    | "database-lowercase"
    | "namespace-uppercase"
    | "namespace-lowercase"
    | "root";
  body: Record<string, string>;
};

/**
 * Lightweight replacement for the old SDK StringRecordId.
 *
 * Direct HTTP /sql does not serialize SDK RecordId classes.
 * Values created with rid(...) are converted into:
 *
 *   type::record("table", "id")
 *
 * inside injected LET statements.
 */
export class StringRecordId {
  readonly __surrealHttpRecordId = true;

  constructor(readonly value: string) {}

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }
}

/**
 * Minimal SurrealDB client using:
 *
 *   POST /signin
 *   POST /sql
 *
 * This avoids the /rpc JSON-RPC envelope entirely.
 *
 * Kept compatible with the usual SDK style:
 *
 *   const db = await getDb();
 *   const [rows] = await db.query<[TenantRow[]]>("SELECT ...", vars);
 */
export class SurrealHttpSqlClient {
  readonly baseUrl: string;
  readonly sqlUrl: string;
  readonly signinUrl: string;
  readonly namespace: string;
  readonly database: string;
  readonly user: string;
  readonly pass: string;

  private tokenPromise: Promise<string> | null = null;

  constructor(options: {
    url: string;
    user: string;
    pass: string;
    namespace: string;
    database: string;
  }) {
    this.baseUrl = normalizeBaseUrl(options.url);
    this.sqlUrl = `${this.baseUrl}/sql`;
    this.signinUrl = `${this.baseUrl}/signin`;
    this.namespace = options.namespace;
    this.database = options.database;
    this.user = options.user;
    this.pass = options.pass;
  }

  async query<T extends unknown[] = unknown[]>(
    sql: string,
    vars: JsonObject = {},
  ): Promise<T> {
    const prepared = prepareSqlQuery(sql, vars);
    const raw = await this.sqlWithAuthRetry(prepared.sql);

    return unwrapSqlResult<T>(
      raw,
      prepared.injectedStatementCount,
    );
  }

  /**
   * Raw /sql response. Useful for debugging.
   */
  async queryRaw(
    sql: string,
    vars: JsonObject = {},
  ): Promise<unknown> {
    const prepared = prepareSqlQuery(sql, vars);
    return await this.sqlWithAuthRetry(prepared.sql);
  }

  /**
   * No-op kept for compatibility with the previous SDK-based code.
   *
   * HTTP is stateless. There is no socket to close.
   */
  async close(): Promise<void> {
    this.tokenPromise = null;
  }

  private async sqlWithAuthRetry(sql: string): Promise<unknown> {
    try {
      return await this.sql(sql);
    } catch (error) {
      /**
       * Retry only when the failure looks auth/token related.
       *
       * This is safe for the common case of an expired cached token.
       * The first request will not execute if authentication failed before
       * execution, so retrying with a fresh token is acceptable.
       */
      if (!isAuthLikeError(error)) {
        throw error;
      }

      this.tokenPromise = null;
      return await this.sql(sql);
    }
  }

  private async sql(sql: string): Promise<unknown> {
    const token = await this.getToken();

    const response = await fetch(this.sqlUrl, {
      method: "POST",
      headers: {
        /**
         * The /sql endpoint receives raw SurrealQL in the body.
         */
        "Content-Type": "text/plain; charset=utf-8",
        "Accept": "application/json",

        /**
         * SurrealDB docs commonly show:
         *
         *   Authorization: Bearer <token>
         *
         * Some examples/gateways also support:
         *
         *   Bearer: <token>
         *
         * Sending both makes the client tolerant across Cloud/runtime changes.
         */
        "Authorization": `Bearer ${token}`,
        "Bearer": token,

        /**
         * Namespace/database used by this query.
         */
        "Surreal-NS": this.namespace,
        "Surreal-DB": this.database,

        /**
         * Auth scope hints.
         *
         * These help when authenticating a DATABASE user over HTTP.
         * If ignored by the server, they are harmless.
         */
        "Surreal-Auth-NS": this.namespace,
        "Surreal-Auth-DB": this.database,
      },
      body: sql,
    });

    const text = await response.text();
    const payload = parseJsonOrText(text);

    if (!response.ok) {
      console.error("[surreal:http-sql:error]", {
        status: response.status,
        statusText: response.statusText,
        sqlUrl: this.sqlUrl,
        sql,
        responseText: text,
        payload,
      });

      throw new SurrealHttpError(
        `SurrealDB /sql failed: HTTP ${response.status} ${response.statusText} | ${
          stringifyPayloadForMessage(payload)
        }`,
        {
          status: response.status,
          statusText: response.statusText,
          payload,
          text,
          sql,
        },
      );
    }

    /**
     * /sql should normally return an array of statement results.
     * However, auth/proxy errors may still return a top-level object/string.
     */
    if (isTopLevelError(payload)) {
      const message = extractErrorMessage(payload);

      console.error("[surreal:http-sql:top-level-error]", {
        message,
        sqlUrl: this.sqlUrl,
        sql,
        payload,
      });

      throw new SurrealHttpError(
        `SurrealDB /sql error: ${message}`,
        {
          payload,
          sql,
        },
      );
    }

    return payload;
  }

  private async getToken(): Promise<string> {
    if (!this.tokenPromise) {
      this.tokenPromise = this.signin();
    }

    return this.tokenPromise;
  }

  private async signin(): Promise<string> {
    /**
     * Try DATABASE user first.
     *
     * Expected backend setup:
     *
     *   USE NS your_namespace DB your_database;
     *
     *   DEFINE USER app_backend ON DATABASE
     *     PASSWORD "..."
     *     ROLES EDITOR;
     *
     * The uppercase NS/DB shape is the important one for current SurrealDB HTTP
     * authentication, but lowercase attempts are kept as fallback.
     */
    const attempts: SigninAttempt[] = [
      {
        kind: "database-uppercase",
        body: {
          NS: this.namespace,
          DB: this.database,
          user: this.user,
          pass: this.pass,
        },
      },
      {
        kind: "database-lowercase",
        body: {
          ns: this.namespace,
          db: this.database,
          user: this.user,
          pass: this.pass,
        },
      },
      {
        kind: "namespace-uppercase",
        body: {
          NS: this.namespace,
          user: this.user,
          pass: this.pass,
        },
      },
      {
        kind: "namespace-lowercase",
        body: {
          ns: this.namespace,
          user: this.user,
          pass: this.pass,
        },
      },
      {
        kind: "root",
        body: {
          user: this.user,
          pass: this.pass,
        },
      },
    ];

    const errors: unknown[] = [];

    for (const attempt of attempts) {
      try {
        const response = await fetch(this.signinUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",

            /**
             * These headers help SurrealDB know where the user exists.
             * They are especially useful for DATABASE users.
             */
            "Surreal-NS": this.namespace,
            "Surreal-DB": this.database,
            "Surreal-Auth-NS": this.namespace,
            "Surreal-Auth-DB": this.database,
          },
          body: JSON.stringify(attempt.body),
        });

        const text = await response.text();
        const payload = parseJsonOrText(text);

        if (!response.ok) {
          errors.push({
            kind: attempt.kind,
            status: response.status,
            statusText: response.statusText,
            text,
            payload,
          });

          continue;
        }

        const token = extractSigninToken(payload);

        if (!token) {
          errors.push({
            kind: attempt.kind,
            message: "Signin response did not contain a token",
            text,
            payload,
          });

          continue;
        }

        console.log("[surreal:signin:ok]", {
          kind: attempt.kind,
          namespace: this.namespace,
          database: this.database,
        });

        return token;
      } catch (error) {
        errors.push({
          kind: attempt.kind,
          error: error instanceof Error
            ? {
              name: error.name,
              message: error.message,
            }
            : String(error),
        });
      }
    }

    console.error("[surreal:signin:error]", {
      signinUrl: this.signinUrl,
      namespace: this.namespace,
      database: this.database,
      attempts: errors,
    });

    throw new SurrealHttpError(
      "SurrealDB signin failed. Check user, password, namespace, database, auth level and role.",
      errors,
    );
  }
}

export type Surreal = SurrealHttpSqlClient;

export class SurrealHttpError extends Error {
  constructor(
    message: string,
    readonly details: unknown,
  ) {
    super(message);
    this.name = "SurrealHttpError";
  }
}

export class SurrealStatementError extends Error {
  constructor(
    message: string,
    readonly details: unknown,
  ) {
    super(message);
    this.name = "SurrealStatementError";
  }
}

/**
 * Wrap a SurrealDB record ID string for use as a query variable.
 *
 * Example:
 *
 *   await db.query(
 *     "SELECT * FROM tenant WHERE systemId = $systemId",
 *     { systemId: rid("system:abc") },
 *   );
 *
 * Internally rewritten to:
 *
 *   LET $systemId = type::record("system", "abc");
 *   SELECT * FROM tenant WHERE systemId = $systemId;
 */
export function rid(id: unknown): StringRecordId {
  const normalized = normalizeRecordId(id) ?? String(id);
  return new StringRecordId(normalized);
}

export function normalizeRecordIds(values: unknown[]): string[] {
  const uniqueIds = new Set<string>();

  for (const value of values) {
    const id = normalizeRecordId(value);
    if (id) {
      uniqueIds.add(id);
    }
  }

  return [...uniqueIds];
}

/** Extract a string record ID from SurrealDB response objects. */
export function normalizeRecordId(value: unknown): string | null {
  if (!value) return null;

  if (value instanceof StringRecordId) {
    return value.value.trim() || null;
  }

  if (typeof value === "string") {
    return value.trim() || null;
  }

  const stringified = String(value).trim();

  if (/^[^:\s]+:[^:\s]+$/.test(stringified)) {
    return stringified;
  }

  if (typeof value === "object") {
    const record = value as {
      id?: unknown;
      tb?: unknown;
      value?: unknown;
      String?: unknown;
    };

    /**
     * SDK-like RecordId object:
     *
     *   { tb: "system", id: "abc" }
     */
    if (typeof record.tb === "string") {
      const innerId = typeof record.id === "string"
        ? record.id
        : record.id != null
        ? String((record.id as { String?: string }).String ?? record.id)
        : "";

      if (innerId) {
        return `${record.tb}:${innerId}`;
      }
    }

    if (typeof record.id === "string") {
      const recordId = record.id.trim();
      return recordId || null;
    }

    if (typeof record.value === "string") {
      const recordId = record.value.trim();
      if (/^[^:\s]+:[^:\s]+$/.test(recordId)) {
        return recordId;
      }
    }

    if (typeof record.String === "string") {
      const recordId = record.String.trim();
      if (/^[^:\s]+:[^:\s]+$/.test(recordId)) {
        return recordId;
      }
    }
  }

  return stringified || null;
}

/**
 * Recursively convert Set and known SurrealDB-ish values for JSON serialization.
 *
 * Useful before returning values from Next.js handlers/components.
 */
export function setsToArrays<T>(value: T): T {
  if (value instanceof Set) {
    return [...value].map(setsToArrays) as T;
  }

  if (Array.isArray(value)) {
    return value.map(setsToArrays) as T;
  }

  if (value instanceof StringRecordId) {
    return value.toString() as T;
  }

  if (value && typeof value === "object" && !(value instanceof Date)) {
    if (
      value.constructor?.name === "RecordId" ||
      value.constructor?.name === "StringRecordId"
    ) {
      return normalizeRecordId(value) as T;
    }

    if (value.constructor?.name === "DateTime") {
      return (value as unknown as { toISOString(): string }).toISOString() as T;
    }

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = setsToArrays(v);
    }

    return out as T;
  }

  return value;
}

let dbInstance: SurrealHttpSqlClient | null = null;
let dbInitPromise: Promise<SurrealHttpSqlClient> | null = null;
let dbClosePromise: Promise<void> | null = null;

function assertDbConfig(): void {
  const missing: string[] = [];

  if (!DB_URL) missing.push("url");
  if (!DB_USER) missing.push("user");
  if (!DB_PASS) missing.push("pass");
  if (!DB_NAMESPACE) missing.push("namespace");
  if (!DB_DATABASE) missing.push("database");

  if (missing.length > 0) {
    throw new Error(
      `Missing database.json fields: ${missing.join(", ")}`,
    );
  }
}

export async function getDb(): Promise<SurrealHttpSqlClient> {
  assertDbConfig();

  if (dbClosePromise) {
    await dbClosePromise;
  }

  if (dbInstance) {
    return dbInstance;
  }

  if (dbInitPromise) {
    return dbInitPromise;
  }

  dbInitPromise = Promise.resolve()
    .then(() => {
      const db = new SurrealHttpSqlClient({
        url: DB_URL,
        user: DB_USER,
        pass: DB_PASS,
        namespace: DB_NAMESPACE,
        database: DB_DATABASE,
      });

      dbInstance = db;
      return db;
    })
    .catch((error) => {
      dbInstance = null;
      throw error;
    })
    .finally(() => {
      dbInitPromise = null;
    });

  return dbInitPromise;
}

export async function closeDb(): Promise<void> {
  if (dbClosePromise) {
    return dbClosePromise;
  }

  const dbToClose = dbInstance;
  const initToWait = dbInitPromise;

  dbInstance = null;
  dbInitPromise = null;

  dbClosePromise = (async () => {
    try {
      const initializedDb = dbToClose ??
        (initToWait ? await initToWait.catch(() => null) : null);

      if (initializedDb) {
        await initializedDb.close();
      }
    } finally {
      dbClosePromise = null;
    }
  })();

  return dbClosePromise;
}

function normalizeBaseUrl(url: string): string {
  return url
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/(rpc|sql|signin)$/, "");
}

function parseJsonOrText(text: string): unknown {
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isTopLevelError(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  if (Array.isArray(payload)) {
    return false;
  }

  return "error" in payload ||
    ("code" in payload && "details" in payload);
}

function extractErrorMessage(payload: unknown): string {
  if (typeof payload === "string") {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return "Unknown SurrealDB error";
  }

  const record = payload as {
    error?: unknown;
    code?: unknown;
    details?: unknown;
    description?: unknown;
    message?: unknown;
    information?: unknown;
  };

  if (typeof record.error === "string") {
    return record.error;
  }

  if (record.error && typeof record.error === "object") {
    const err = record.error as {
      code?: unknown;
      message?: unknown;
      data?: unknown;
    };

    const code = err.code != null ? `RPC ${String(err.code)}: ` : "";
    const message = err.message != null
      ? String(err.message)
      : "Unknown SurrealDB RPC error";

    if (err.data != null) {
      return `${code}${message} | data: ${safeStringify(err.data)}`;
    }

    return `${code}${message}`;
  }

  if (typeof record.information === "string") {
    return record.information;
  }

  if (typeof record.message === "string") {
    return record.message;
  }

  if (typeof record.details === "string") {
    return record.details;
  }

  if (typeof record.description === "string") {
    return record.description;
  }

  return safeStringify(payload);
}

function stringifyPayloadForMessage(payload: unknown): string {
  if (typeof payload === "string") {
    return payload.slice(0, 2000);
  }

  return safeStringify(payload).slice(0, 2000);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(
      value,
      (_key, item) => {
        if (typeof item === "bigint") return `${item}n`;
        if (item === undefined) return "__UNDEFINED__";
        return item;
      },
      2,
    );
  } catch {
    return String(value);
  }
}

function isAuthLikeError(error: unknown): boolean {
  const text = error instanceof Error
    ? `${error.name} ${error.message}`
    : String(error);

  return /auth|token|signin|login|permission|forbidden|unauthorized|notallowed|not allowed/i
    .test(text);
}

function extractSigninToken(payload: unknown): string | null {
  if (!payload) {
    return null;
  }

  /**
   * Some endpoints may return the token as plain JSON string.
   */
  if (typeof payload === "string") {
    return payload.trim() || null;
  }

  if (typeof payload !== "object") {
    return null;
  }

  const record = payload as {
    token?: unknown;
    result?: unknown;
  };

  /**
   * REST /signin common shape:
   *
   *   { token: "..." }
   */
  if (typeof record.token === "string" && record.token) {
    return record.token;
  }

  /**
   * RPC-like shape:
   *
   *   { result: "..." }
   */
  if (typeof record.result === "string" && record.result) {
    return record.result;
  }

  /**
   * Nested shape:
   *
   *   { result: { token: "..." } }
   */
  if (
    record.result &&
    typeof record.result === "object" &&
    typeof (record.result as { token?: unknown }).token === "string"
  ) {
    return (record.result as { token: string }).token;
  }

  return null;
}

/**
 * Prepare a /sql query.
 *
 * Since /sql receives SurrealQL text, this function injects parameters as
 * SurrealQL LET statements.
 *
 * Example:
 *
 *   db.query("SELECT * FROM tenant WHERE systemId = $systemId", {
 *     systemId: rid("system:abc")
 *   })
 *
 * becomes:
 *
 *   LET $systemId = type::record("system", "abc");
 *   SELECT * FROM tenant WHERE systemId = $systemId;
 */
function prepareSqlQuery(
  sql: string,
  vars: JsonObject = {},
): PreparedSqlQuery {
  const injectedStatements: string[] = [];

  for (const [name, value] of Object.entries(vars)) {
    assertSurrealVariableName(name);

    const expression = toSurrealLiteral(value);
    injectedStatements.push(`LET $${name} = ${expression};`);
  }

  if (injectedStatements.length === 0) {
    return {
      sql,
      injectedStatementCount: 0,
    };
  }

  return {
    sql: `${injectedStatements.join("\n")}\n${sql}`,
    injectedStatementCount: injectedStatements.length,
  };
}

function toSurrealLiteral(value: unknown): string {
  if (value === undefined) {
    return "NONE";
  }

  if (value === null) {
    return "NULL";
  }

  if (isRecordIdValue(value)) {
    const recordId = normalizeRecordId(value);

    if (!recordId) {
      throw new Error(`Invalid SurrealDB record id: ${String(value)}`);
    }

    const { table, id } = splitRecordId(recordId);

    /**
     * SurrealDB 3 uses type::record(...) for constructing a Record ID.
     * Older snippets often used type::thing(...), which now fails with:
     *
     *   Invalid function/constant path, did you maybe mean `type::record`
     */
    return `type::record(${JSON.stringify(table)}, ${JSON.stringify(id)})`;
  }

  if (value instanceof Set) {
    return `<set>[${[...value].map(toSurrealLiteral).join(", ")}]`;
  }

  if (Array.isArray(value)) {
    return `[${value.map(toSurrealLiteral).join(", ")}]`;
  }

  if (value instanceof Date) {
    return `d${JSON.stringify(value.toISOString())}`;
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Cannot send non-finite number to SurrealDB: ${value}`);
    }

    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value && typeof value === "object") {
    if (value.constructor?.name === "DateTime") {
      return `d${
        JSON.stringify(
          (value as { toISOString(): string }).toISOString(),
        )
      }`;
    }

    const fields = Object.entries(value as Record<string, unknown>).map(
      ([key, fieldValue]) => {
        return `${JSON.stringify(key)}: ${toSurrealLiteral(fieldValue)}`;
      },
    );

    return `{ ${fields.join(", ")} }`;
  }

  return JSON.stringify(String(value));
}

function isRecordIdValue(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (value instanceof StringRecordId) {
    return true;
  }

  const maybeRecord = value as {
    __surrealHttpRecordId?: unknown;
    tb?: unknown;
    id?: unknown;
  };

  if (maybeRecord.__surrealHttpRecordId === true) {
    return true;
  }

  if (
    typeof maybeRecord.tb === "string" &&
    maybeRecord.id !== undefined
  ) {
    return true;
  }

  return (
    value.constructor?.name === "RecordId" ||
    value.constructor?.name === "StringRecordId"
  );
}

function splitRecordId(recordId: string): { table: string; id: string } {
  const index = recordId.indexOf(":");

  if (index <= 0 || index === recordId.length - 1) {
    throw new Error(`Invalid SurrealDB record id: ${recordId}`);
  }

  return {
    table: recordId.slice(0, index),
    id: recordId.slice(index + 1),
  };
}

function assertSurrealVariableName(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(
      `Invalid SurrealDB variable name "${name}". Use only letters, numbers and underscores, and do not start with a number.`,
    );
  }
}

function unwrapSqlResult<T extends unknown[]>(
  raw: unknown,
  injectedStatementCount: number,
): T {
  if (!Array.isArray(raw)) {
    return [raw] as T;
  }

  /**
   * Remove internal LET statement results.
   */
  const userStatements = raw.length > injectedStatementCount
    ? raw.slice(injectedStatementCount)
    : raw;

  const results: unknown[] = [];

  for (const statement of userStatements) {
    if (isSqlQueryStatement(statement)) {
      const status = String(statement.status ?? "OK").toUpperCase();

      if (status === "ERR") {
        const message = typeof statement.result === "string"
          ? statement.result
          : statement.detail ?? "SurrealDB SQL statement failed";

        console.error("[surreal:sql-statement:error]", {
          message,
          statement,
        });

        throw new SurrealStatementError(message, statement);
      }

      results.push(statement.result);
      continue;
    }

    results.push(statement);
  }

  return results as T;
}

function isSqlQueryStatement(value: unknown): value is SqlQueryStatement {
  return !!value &&
    typeof value === "object" &&
    (
      "status" in value ||
      "result" in value ||
      "time" in value ||
      "detail" in value
    );
}
