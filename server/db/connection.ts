import "server-only";

import { StringRecordId, Surreal } from "surrealdb";
import dbConfig from "../../database.json" with { type: "json" };

const DB_URL = dbConfig.url;
const DB_USER = dbConfig.user;
const DB_PASS = dbConfig.pass;
const DB_NAMESPACE = dbConfig.namespace;
const DB_DATABASE = dbConfig.database;

/** Wrap a record ID string (e.g. "system:abc") for use as a SurrealDB binding. */
export function rid(id: unknown): StringRecordId {
  return new StringRecordId(String(id));
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

  if (typeof value === "string") {
    return value.trim() || null;
  }

  const stringified = String(value).trim();
  if (/^[^:\s]+:[^:\s]+$/.test(stringified)) {
    return stringified;
  }

  if (typeof value === "object") {
    const record = value as { id?: unknown; tb?: unknown };
    if (typeof record.tb === "string") {
      const innerId = typeof record.id === "string"
        ? record.id
        : record.id != null
        ? String((record.id as { String?: string }).String ?? record.id)
        : "";
      if (innerId) return `${record.tb}:${innerId}`;
    }

    if (typeof record.id === "string") {
      const recordId = record.id.trim();
      return recordId || null;
    }
  }

  return stringified || null;
}

/** Recursively convert Set and SurrealDB RecordId instances for JSON serialization. */
export function setsToArrays<T>(value: T): T {
  if (value instanceof Set) return [...value].map(setsToArrays) as T;
  if (Array.isArray(value)) return value.map(setsToArrays) as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    if (value.constructor?.name === "RecordId") {
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

let dbInstance: Surreal | null = null;
let dbInitPromise: Promise<Surreal> | null = null;
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

export async function getDb(): Promise<Surreal> {
  assertDbConfig();

  /**
   * If something is closing the connection, wait before opening a new one.
   * This prevents returning a client while closeDb() is still running.
   */
  if (dbClosePromise) {
    await dbClosePromise;
  }

  /**
   * Fast path: already connected in this runtime.
   */
  if (dbInstance) {
    return dbInstance;
  }

  /**
   * If multiple requests call getDb() at the same time, only one connection
   * attempt should happen. Everyone else awaits the same promise.
   */
  if (dbInitPromise) {
    return dbInitPromise;
  }

  dbInitPromise = (async () => {
    const db = new Surreal();

    try {
      /**
       * Keep the original connection style because this was already working
       * in your app.
       */
      await db.connect(DB_URL, {
        authentication: {
          username: DB_USER,
          password: DB_PASS,
        },
      });

      await db.use({
        namespace: DB_NAMESPACE,
        database: DB_DATABASE,
      });

      dbInstance = db;
      return db;
    } catch (error) {
      dbInstance = null;

      try {
        await db.close();
      } catch {
        // Ignore cleanup errors after failed connection.
      }

      throw error;
    } finally {
      /**
       * Important:
       * If the connection fails once, future calls must be allowed to retry.
       * Your original version kept dbInitPromise forever.
       */
      dbInitPromise = null;
    }
  })();

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
