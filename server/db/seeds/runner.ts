import { getDb } from "../connection";
import { seedSuperuser } from "./001_superuser";
import { seedDefaultSettings } from "./002_default_settings";

if (typeof window !== "undefined") {
  throw new Error("Seed runner must not be imported in client-side code.");
}

export async function runSeeds(): Promise<void> {
  const db = await getDb();

  console.log("[seed] running seeds...");
  await seedSuperuser(db);
  await seedDefaultSettings(db);
  console.log("[seed] all seeds applied.");
}
