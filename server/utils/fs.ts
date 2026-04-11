import { getDb } from "@/server/db/connection";
import { SurrealFS } from "@hviana/surreal-fs";

if (typeof window !== "undefined") {
  throw new Error(
    "server/utils/fs.ts must not be imported in client-side code.",
  );
}

let fsInstance: SurrealFS | null = null;

export async function getFS(): Promise<SurrealFS> {
  if (!fsInstance) {
    const db = await getDb();
    fsInstance = new SurrealFS(db);
    await fsInstance.init();
  }
  return fsInstance;
}
