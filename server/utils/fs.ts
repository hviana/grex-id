import { getDb } from "@/server/db/connection";
import { SurrealFS } from "@hviana/surreal-fs";
import { assertServerOnly } from "./server-only.ts";

assertServerOnly("server/utils/fs.ts");

let fsInstance: SurrealFS | null = null;

export async function getFS(): Promise<SurrealFS> {
  if (!fsInstance) {
    const db = await getDb();
    fsInstance = new SurrealFS(db);
    await fsInstance.init();
  }
  return fsInstance;
}
