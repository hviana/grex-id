import { StringRecordId, Surreal } from "surrealdb";
import Core from "../utils/Core.ts";

/** Wrap a record ID string (e.g. "system:abc") for use as a SurrealDB binding. */
export function rid(id: unknown): StringRecordId {
  return new StringRecordId(String(id));
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
