import { StringRecordId, Surreal } from "surrealdb";

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

    await dbInstance.connect(
      "https://nimble-lotus-06ejcq1c1dtvf0lev6qi9hsejk.aws-euw1.surreal.cloud",
      {
        namespace: "main",
        database: "grex-id",
        authentication: {
          username: "admin",
          password: "Grex#1271237-SS",
        },
      },
    );
  }
  return dbInstance;
}
export async function closeDb(): Promise<void> {
  if (dbInstance) {
    await dbInstance.close();
    dbInstance = null;
  }
}
