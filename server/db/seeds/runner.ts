import { getDb } from "../connection.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import type { SeedModule } from "../../../src/contracts/high-level/seeds.ts";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("Seed runner");

const SEEDS_TABLE_INIT = `
DEFINE TABLE IF NOT EXISTS _seeds SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS name ON _seeds TYPE string;
DEFINE FIELD IF NOT EXISTS appliedAt ON _seeds TYPE datetime DEFAULT time::now();
DEFINE INDEX IF NOT EXISTS idx_seeds_name ON _seeds FIELDS name UNIQUE;
`;

export async function runSeeds(): Promise<void> {
  const db = await getDb();

  await db.query(SEEDS_TABLE_INIT);

  const seedsDir = path.dirname(new URL(import.meta.url).pathname);

  // Collect core seeds from the root directory
  const coreFiles = fs
    .readdirSync(seedsDir)
    .filter((f) => /^\d{3}_.*\.ts$/.test(f))
    .map((f) => ({ name: f, filePath: path.join(seedsDir, f) }));

  // Collect system seeds from systems/<slug>/server/db/seeds/
  const systemsRoot = path.resolve(seedsDir, "../../../systems");
  const systemFiles: { name: string; filePath: string }[] = [];
  if (fs.existsSync(systemsRoot)) {
    for (const slug of fs.readdirSync(systemsRoot)) {
      const slugSeedsDir = path.join(
        systemsRoot,
        slug,
        "server",
        "db",
        "seeds",
      );
      if (!fs.existsSync(slugSeedsDir)) continue;
      for (const f of fs.readdirSync(slugSeedsDir)) {
        if (!/^\d{3}_.*\.ts$/.test(f)) continue;
        systemFiles.push({
          name: `systems/${slug}/${f}`,
          filePath: path.join(slugSeedsDir, f),
        });
      }
    }
  }

  // Collect framework seeds from frameworks/[name]/server/db/seeds/
  const frameworksDir = path.resolve(seedsDir, "../../../frameworks");
  const frameworkFiles: { name: string; filePath: string }[] = [];
  if (fs.existsSync(frameworksDir)) {
    for (const fwName of fs.readdirSync(frameworksDir)) {
      const fwSeedsDir = path.join(
        frameworksDir,
        fwName,
        "server",
        "db",
        "seeds",
      );
      if (!fs.existsSync(fwSeedsDir)) continue;
      for (const f of fs.readdirSync(fwSeedsDir)) {
        if (!/^\d{3}_.*\.ts$/.test(f)) continue;
        frameworkFiles.push({
          name: `frameworks/${fwName}/${f}`,
          filePath: path.join(fwSeedsDir, f),
        });
      }
    }
  }

  // Sort all seeds by numeric prefix globally
  const getPrefix = (name: string) => {
    const base = name.includes("/") ? name.split("/").pop()! : name;
    return base.split("_")[0];
  };
  const files = [...coreFiles, ...systemFiles, ...frameworkFiles].sort(
    (a, b) => getPrefix(a.name).localeCompare(getPrefix(b.name)),
  );

  // Load already-applied seed names
  const applied = await db.query<[{ name: string }[]]>(
    "SELECT name FROM _seeds",
  );
  const appliedNames = new Set(
    (applied[0] ?? []).map((r: { name: string }) => r.name),
  );

  const pending = files.filter((f) => !appliedNames.has(f.name));
  console.log(
    `[seed] ${files.length} seed(s) found, ${pending.length} pending, ${appliedNames.size} already applied.`,
  );

  for (const { name, filePath } of pending) {
    console.log(`[seed] applying: ${name}`);
    const mod = (await import(filePath)) as SeedModule;
    await mod.seed(db);
    // Record the seed as applied (idempotent via unique index)
    await db.query("CREATE _seeds SET name = $name", { name });
    console.log(`[seed] applied: ${name}`);
  }

  console.log("[seed] all seeds applied.");
}
