import { getDb } from "../connection.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("Migration runner");

const MIGRATIONS_TABLE_INIT = `
DEFINE TABLE IF NOT EXISTS _migrations SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS name ON _migrations TYPE string;
DEFINE FIELD IF NOT EXISTS appliedAt ON _migrations TYPE datetime DEFAULT time::now();
DEFINE INDEX IF NOT EXISTS idx_migrations_name ON _migrations FIELDS name UNIQUE;
`;

export async function runMigrations(): Promise<void> {
  const db = await getDb();

  await db.query(MIGRATIONS_TABLE_INIT);

  const migrationsDir = path.join(
    path.dirname(new URL(import.meta.url).pathname),
  );

  // Collect core migrations from the root directory
  const coreFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".surql"))
    .map((f) => ({ name: f, filePath: path.join(migrationsDir, f) }));

  // Collect system-specific migrations from systems/<slug>/server/db/migrations/
  const systemsRoot = path.resolve(migrationsDir, "../../../systems");
  const systemFiles: { name: string; filePath: string }[] = [];
  if (fs.existsSync(systemsRoot)) {
    for (const slug of fs.readdirSync(systemsRoot)) {
      const slugMigrationsDir = path.join(
        systemsRoot,
        slug,
        "server",
        "db",
        "migrations",
      );
      if (!fs.existsSync(slugMigrationsDir)) continue;
      for (const f of fs.readdirSync(slugMigrationsDir)) {
        if (!f.endsWith(".surql")) continue;
        systemFiles.push({
          name: `systems/${slug}/${f}`,
          filePath: path.join(slugMigrationsDir, f),
        });
      }
    }
  }

  // Collect framework-specific migrations from frameworks/<name>/server/db/migrations/
  const frameworksRoot = path.resolve(migrationsDir, "../../../frameworks");
  const frameworkFiles: { name: string; filePath: string }[] = [];
  if (fs.existsSync(frameworksRoot)) {
    for (const fwName of fs.readdirSync(frameworksRoot)) {
      const fwMigrationsDir = path.join(
        frameworksRoot,
        fwName,
        "server",
        "db",
        "migrations",
      );
      if (!fs.existsSync(fwMigrationsDir)) continue;
      for (const f of fs.readdirSync(fwMigrationsDir)) {
        if (!f.endsWith(".surql")) continue;
        frameworkFiles.push({
          name: `frameworks/${fwName}/${f}`,
          filePath: path.join(fwMigrationsDir, f),
        });
      }
    }
  }

  // Merge and sort all migrations by numeric prefix (e.g. "0025" from "0025_create_foo.surql")
  const getPrefix = (name: string) => {
    const base = name.includes("/") ? name.split("/").pop()! : name;
    return base.split("_")[0];
  };
  const files = [...coreFiles, ...systemFiles, ...frameworkFiles].sort(
    (a, b) => getPrefix(a.name).localeCompare(getPrefix(b.name)),
  );

  const applied = await db.query<[{ name: string }[]]>(
    "SELECT name FROM _migrations",
  );
  const appliedNames = new Set(
    (applied[0] ?? []).map((r: { name: string }) => r.name),
  );

  for (const { name: migrationName, filePath } of files) {
    if (appliedNames.has(migrationName)) continue;

    const sql = fs.readFileSync(filePath, "utf-8");

    console.log(`[migration] applying: ${migrationName}`);

    try {
      const transactionSql = `
BEGIN TRANSACTION;
${sql}
CREATE _migrations SET name = $name, appliedAt = time::now();
COMMIT TRANSACTION;
`;
      await db.query(transactionSql, { name: migrationName });
      console.log(`[migration] applied: ${migrationName}`);
    } catch (err) {
      console.error(`[migration] failed: ${migrationName}`, err);
      throw err;
    }
  }

  console.log("[migration] all migrations applied.");
}
