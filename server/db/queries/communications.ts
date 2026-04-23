import { getDb, rid } from "../connection.ts";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("communications");

/**
 * Resolve recipient values from raw recipient entries. Raw values that are
 * entity_channel owner record ids (user:…, lead:…) are resolved by fetching
 * the owner's channels array and filtering by type + verified status. Non-record-id
 * entries are returned as-is.
 */
export async function resolveChannelRecipients(
  rawRecipients: string[],
  channelType: string,
): Promise<string[]> {
  const resolved: string[] = [];
  const db = await getDb();
  for (const entry of rawRecipients) {
    if (typeof entry !== "string" || entry.length === 0) continue;
    const table = entry.split(":")[0];
    if (table !== "user" && table !== "lead") {
      resolved.push(entry);
      continue;
    }
    const result = await db.query<[{ value: string }[]]>(
      `LET $owner = (SELECT channels FROM ${table} WHERE id = $ownerId)[0];
       IF $owner = NONE { RETURN []; };
       SELECT value FROM entity_channel
       WHERE id IN $owner.channels AND type = $type AND verified = true
       ORDER BY createdAt ASC;`,
      { ownerId: rid(entry), type: channelType },
    );
    for (const row of result[0] ?? []) {
      if (row.value) resolved.push(row.value);
    }
  }
  return [...new Set(resolved)];
}
