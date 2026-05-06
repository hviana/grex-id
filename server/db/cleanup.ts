import { Surreal } from "surrealdb";
import dbConfig from "../../database.json" with { type: "json" };

async function main() {
  const db = new Surreal();
  await db.connect(dbConfig.url, {
    authentication: { username: dbConfig.user, password: dbConfig.pass },
  });
  await db.use({ namespace: dbConfig.namespace, database: dbConfig.database });

  console.log("[cleanup] Connected. Fetching DB info...");

  const tablesResult = await db.query("INFO FOR DB");
  const dbInfo = tablesResult[0] as Record<string, unknown>;

  const tables = dbInfo?.tables as Record<string, unknown> | undefined;
  if (tables) {
    const names = Object.keys(tables);
    console.log(`[cleanup] Found ${names.length} tables: ${names.join(", ")}`);
    for (const tableName of names) {
      console.log(`[cleanup] Removing table: ${tableName}`);
      try {
        await db.query(`REMOVE TABLE ${tableName}`);
      } catch (e: unknown) {
        console.log(
          `[cleanup] Error removing table ${tableName}: ${
            (e as Error).message
          }`,
        );
      }
    }
  }

  const analyzers = dbInfo?.analyzers as Record<string, unknown> | undefined;
  if (analyzers) {
    const names = Object.keys(analyzers);
    console.log(
      `[cleanup] Found ${names.length} analyzers: ${names.join(", ")}`,
    );
    for (const analyzerName of names) {
      console.log(`[cleanup] Removing analyzer: ${analyzerName}`);
      try {
        await db.query(`REMOVE ANALYZER ${analyzerName}`);
      } catch (e: unknown) {
        console.log(
          `[cleanup] Error removing analyzer ${analyzerName}: ${
            (e as Error).message
          }`,
        );
      }
    }
  }

  console.log("[cleanup] Cleanup complete.");
  await db.close();
}

main().catch(async (err) => {
  console.error("[cleanup] Failed:", err);
  await new Surreal().close().catch(() => {});
});
