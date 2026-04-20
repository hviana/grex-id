import { StringRecordId, Surreal } from "surrealdb";
import Core from "../utils/Core.ts";

/** Wrap a record ID string (e.g. "system:abc") for use as a SurrealDB binding. */
export function rid(id: unknown): StringRecordId {
  return new StringRecordId(String(id));
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

if (typeof window !== "undefined") {
  throw new Error(
    "server/db/connection.ts must not be imported in client-side code.",
  );
}

let dbInstance: Surreal | null = null;

export async function getDb(): Promise<Surreal> {
  if (!dbInstance) {
    dbInstance = new Surreal();

    await dbInstance.connect(Core.DB_URL, {
      authentication: {
        username: Core.DB_USER,
        password: Core.DB_PASS,
      },
    });
    await dbInstance.use({
      namespace: Core.DB_NAMESPACE,
      database: Core.DB_DATABASE,
    });
  }
  return dbInstance;
}
export async function closeDb(): Promise<void> {
  if (dbInstance) {
    await dbInstance.close();
    dbInstance = null;
  }
}
