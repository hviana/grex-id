import { getDb, rid } from "../connection.ts";
import type { StringRecordId } from "surrealdb";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("communications");

/**
 * Resolve recipient channel values from entity record ids.
 *
 * - Each entry must resolve to a user:… / lead:… record id.
 * - Fetches the owner's entity_channels of the requested type and returns
 *   their values (emails, phone numbers, etc.).
 * - Only verified channels are included by default.
 * - When `options.includeUnverified` is true, unverified channels belonging to
 *   the owner are also included — but only if that (type, value) pair is NOT
 *   already verified by a DIFFERENT entity.
 *
 * All owner lookups are batched into a single db.query() call.
 */
export async function resolveChannelRecipients(
  rawRecipients: string[],
  channelType: string,
  options?: { includeUnverified?: boolean },
): Promise<string[]> {
  const owners: { table: string; id: StringRecordId }[] = [];

  for (const raw of rawRecipients) {
    let entry: string;
    if (typeof raw === "string") {
      entry = raw;
    } else if (raw != null && typeof raw === "object") {
      const str = String(raw);
      if (str !== "[object Object]") {
        entry = str;
      } else if ("tb" in raw && "id" in raw) {
        entry = `${(raw as { tb: string }).tb}:${
          String((raw as { id: unknown }).id)
        }`;
      } else if ("id" in raw) {
        entry = String((raw as { id: unknown }).id);
      } else {
        continue;
      }
    } else {
      continue;
    }

    if (!entry || entry.length === 0) continue;
    const table = entry.split(":")[0];
    owners.push({ table, id: rid(entry) });
  }

  if (owners.length === 0) {
    return [];
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
  const resolved: string[] = [];
  if (Array.isArray(values)) {
    for (const v of values) resolved.push(String(v));
  }
  return [...new Set(resolved)];
}
