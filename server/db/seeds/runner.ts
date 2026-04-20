import { getDb } from "../connection.ts";
import * as fs from "node:fs";
import * as path from "node:path";

if (typeof window !== "undefined") {
  throw new Error("Seed runner must not be imported in client-side code.");
}

interface SeedModule {
  seed: (db: import("surrealdb").Surreal) => Promise<void>;
}

export async function runSeeds(): Promise<void> {
  const db = await getDb();

  const seedsDir = path.dirname(new URL(import.meta.url).pathname);

  // Collect core seeds from the root directory
  const coreFiles = fs
    .readdirSync(seedsDir)
    .filter((f) => /^\d{3}_.*\.ts$/.test(f))
    .map((f) => ({ name: f, filePath: path.join(seedsDir, f) }));

  // Collect system seeds from systems/[slug]/ subfolders
  const systemsDir = path.join(seedsDir, "systems");
  const systemFiles: { name: string; filePath: string }[] = [];
  if (fs.existsSync(systemsDir)) {
    for (const slug of fs.readdirSync(systemsDir)) {
      const slugDir = path.join(systemsDir, slug);
      if (!fs.statSync(slugDir).isDirectory()) continue;
      for (const f of fs.readdirSync(slugDir)) {
        if (!/^\d{3}_.*\.ts$/.test(f)) continue;
        systemFiles.push({
          name: `systems/${slug}/${f}`,
          filePath: path.join(slugDir, f),
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

  console.log(`[seed] running ${files.length} seed(s)...`);

  for (const { name, filePath } of files) {
    console.log(`[seed] applying: ${name}`);
    const mod = (await import(filePath)) as SeedModule;
    await mod.seed(db);
    console.log(`[seed] applied: ${name}`);
  }

  console.log("[seed] all seeds applied.");
}
