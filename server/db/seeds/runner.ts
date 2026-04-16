import { getDb } from "../connection.ts";
import { seedSuperuser } from "./001_superuser.ts";
import { seedDefaultSettings } from "./002_default_settings.ts";
import { seedDefaultFrontSettings } from "./003_default_front_settings.ts";

if (typeof window !== "undefined") {
  throw new Error("Seed runner must not be imported in client-side code.");
}

export async function runSeeds(): Promise<void> {
  const db = await getDb();

  console.log("[seed] running seeds...");
  await seedSuperuser(db);
  await seedDefaultSettings(db);
  await seedDefaultFrontSettings(db);
  console.log("[seed] all seeds applied.");
}
