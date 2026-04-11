import { runMigrations } from "./migrations/runner.ts";
import { runSeeds } from "./seeds/runner.ts";
import { closeDb } from "./connection.ts";

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
