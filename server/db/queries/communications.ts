import { getDb, rid } from "../connection.ts";
import type { StringRecordId } from "surrealdb";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("communications");

/**
 * Resolve recipient channel values from raw recipient entries.
 *
 * - Raw values that aren't user/lead record ids are returned as-is.
 * - For user:… / lead:… ids, fetches the owner's entity_channels of the
 *   requested type. Only verified channels are included by default.
 * - When `options.includeUnverified` is true, unverified channels belonging to
 *   the owner are also included — but only if that (type, value) pair is NOT
 *   already verified by a DIFFERENT entity. This prevents sending to an
 *   unverified channel whose value another user or lead has already claimed.
 *
 * All owner lookups are batched into a single db.query() call (§7.2).
 */
export async function resolveChannelRecipients(
  rawRecipients: string[],
  channelType: string,
  options?: { includeUnverified?: boolean },
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

  const db = await getDb();
  const includeUnverified = !!options?.includeUnverified;

  // Build one LET per owner to fetch their channelIds, then resolve channels.
  const vars: Record<string, unknown> = { type: channelType };
  const letStmts: string[] = [];

  for (let i = 0; i < owners.length; i++) {
    const { table, id } = owners[i];
    vars[`owner_${i}`] = id;
    letStmts.push(
      `LET $channels_${i} = (SELECT channelIds FROM ${table} WHERE id = $owner_${i})[0].channelIds ?? [];`,
    );
  }

  const allRefs = owners.map((_, i) => `$channels_${i}`).join(", ");
  letStmts.push(`LET $allChannels = array::flatten([${allRefs}]);`);

  // Fetch the owner's channels of the requested type (verified + optionally
  // unverified), then exclude any unverified channel whose (type, value) is
  // already verified by a different entity.
  letStmts.push(
    `LET $ownerChannels = SELECT * FROM entity_channel
       WHERE id IN $allChannels AND type = $type
       ${includeUnverified ? "" : "AND verified = true"}
       ORDER BY verified DESC, createdAt ASC;`,
  );

  if (includeUnverified) {
    // Collect the values of unverified channels so we can check for conflicts.
    letStmts.push(
      `LET $unverifiedValues = array::distinct(
         SELECT VALUE value FROM $ownerChannels WHERE verified = false
       );`,
    );
    // Find channels verified by OTHER entities that share those values.
    letStmts.push(
      `LET $conflictingValues = SELECT VALUE value FROM entity_channel
         WHERE value IN $unverifiedValues AND verified = true
           AND id NOT IN $allChannels;`,
    );
    // Final set: all verified + unverified whose value isn't claimed elsewhere.
    letStmts.push(
      `LET $result = (SELECT VALUE value FROM $ownerChannels
         WHERE verified = true OR value NOT IN $conflictingValues);`,
    );
  } else {
    letStmts.push(
      `LET $result = (SELECT VALUE value FROM $ownerChannels);`,
    );
  }

  const query = letStmts.join("\n") + "\n" + "RETURN $result;";
  const result = await db.query<string[][]>(query, vars);

  // RETURN statement result is the last element.
  const values = result[result.length - 1];
  const resolved: string[] = [...rawValues];
  if (Array.isArray(values)) {
    for (const v of values) resolved.push(String(v));
  }
  return [...new Set(resolved)];
}
