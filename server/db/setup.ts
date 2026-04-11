import { runMigrations } from "./migrations/runner";
import { runSeeds } from "./seeds/runner";
import { closeDb } from "./connection";

async function main() {
  console.log("[setup] starting database setup...");
  await runMigrations();
  await runSeeds();
  console.log("[setup] database setup complete.");
  await closeDb();
}

main().catch(async (err) => {
  console.error("[setup] failed:", err);
  await closeDb().catch(() => {});
});
