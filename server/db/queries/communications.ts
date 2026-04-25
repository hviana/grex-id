import { getDb, rid } from "../connection.ts";
import type { StringRecordId } from "surrealdb";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("communications");

/**
 * Resolve recipient values from raw recipient entries. Raw values that are
 * entity_channel owner record ids (user:…, lead:…) are resolved by fetching
 * the owner's channels array and filtering by type + verified status. Non-record-id
 * entries are returned as-is.
 *
 * All owner lookups are batched into a single db.query() call (§7.2).
 */
export async function resolveChannelRecipients(
  rawRecipients: string[],
  channelType: string,
): Promise<string[]> {
  const rawValues: string[] = [];
  const owners: { table: string; id: StringRecordId }[] = [];

  for (const entry of rawRecipients) {
    if (typeof entry !== "string" || entry.length === 0) continue;
    const table = entry.split(":")[0];
    if (table !== "user" && table !== "lead") {
      rawValues.push(entry);
    } else {
      owners.push({ table, id: rid(entry) });
    }
  }

  if (owners.length === 0) {
    return [...new Set(rawValues)];
  }

  // Build dynamic LET statements: one per owner to fetch their channels array,
  // then merge all arrays and SELECT from entity_channel in a single batch.
  const vars: Record<string, unknown> = { type: channelType };
  const letStatements: string[] = [];

  for (let i = 0; i < owners.length; i++) {
    const { table, id } = owners[i];
    const varName = `owner_${i}`;
    vars[varName] = id;
    letStatements.push(
      `LET $channels_${i} = (SELECT channelIds FROM ${table} WHERE id = $${varName})[0].channelIds ?? [];`,
    );
  }

  const allRefs = owners.map((_, i) => `$channels_${i}`).join(", ");
  letStatements.push(
    `LET $allChannels = array::flatten([${allRefs}]);`,
  );

  // Use SELECT * because "value" is a reserved keyword in SurrealDB 3.0 and
  // cannot appear as a bare column name in SELECT.
  const query = letStatements.join("\n") +
    "\n" +
    `SELECT * FROM entity_channel WHERE id IN $allChannels AND type = $type AND verified = true ORDER BY createdAt ASC;`;

  const db = await getDb();
  const result = await db.query<[{ value: string }[]]>(query, vars);

  const resolved: string[] = [...rawValues];
  for (const row of result[result.length - 1] ?? []) {
    if ((row as any).value) resolved.push((row as any).value);
  }
  return [...new Set(resolved)];
}
