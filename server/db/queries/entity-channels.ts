import { getDb, rid } from "../connection.ts";
import type { EntityChannel } from "@/src/contracts/entity-channel";
import type {
  ChannelOwnerMatch,
  EntityChannelOwnerKind,
} from "@/src/contracts/high_level/query-results";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("entity-channels");

export type { ChannelOwnerMatch, EntityChannelOwnerKind };

function ownerTable(kind: EntityChannelOwnerKind): string {
  return kind;
}

/**
 * Normalize a value that may be a plain string record id or a
 * `{tb, id}` object returned by surrealdb.js into a canonical `"tb:id"`
 * string.
 */
function normalizeRecordId(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "object") {
    const record = value as { id?: unknown; tb?: unknown };
    if (typeof record.tb === "string" && typeof record.id === "string") {
      return `${record.tb}:${record.id}`;
    }
    if (typeof record.id === "string") {
      return record.id.trim() || null;
    }
  }
  const s = String(value).trim();
  return s || null;
}

/** Returns the channels referenced by the given user|lead, ordered by creation. */
export async function listChannelsByOwner(
  ownerId: string,
  kind: EntityChannelOwnerKind,
): Promise<EntityChannel[]> {
  const db = await getDb();
  const result = await db.query<[{ channelIds: EntityChannel[] }[]]>(
    `SELECT channelIds FROM ${ownerTable(kind)}
     WHERE id = $ownerId
     FETCH channelIds`,
    { ownerId: rid(ownerId) },
  );
  const row = result[0]?.[0];
  if (!row) return [];
  const chans = (row.channelIds ?? []) as EntityChannel[];
  return [...chans].sort((a, b) => {
    const ca = a?.createdAt ?? "";
    const cb = b?.createdAt ?? "";
    return ca < cb ? -1 : ca > cb ? 1 : 0;
  });
}

/**
 * Atomically creates an `entity_channel` row and appends its id to the
 * parent's `channelIds` array, respecting the `maxPerOwner` cap. Returns the
 * created channel on success, or `null` when the cap is exceeded.
 */
export async function createChannel(params: {
  ownerId: string;
  ownerKind: EntityChannelOwnerKind;
  type: string;
  value: string;
  verified?: boolean;
  maxPerOwner: number;
}): Promise<EntityChannel | null> {
  const db = await getDb();
  const verified = params.verified ?? false;
  const table = ownerTable(params.ownerKind);
  const result = await db.query<unknown[]>(
    `LET $owner = (SELECT id, channelIds FROM ${table} WHERE id = $ownerId), 0);
     LET $count = IF $owner = NONE THEN NONE ELSE set::len($owner.channelIds) END;
     LET $ch = IF ($count != NONE AND $count < $maxPerOwner) THEN (
       CREATE entity_channel SET
         type = $type,
         value = $value,
         verified = $verified
     ) ELSE {} END;
     LET $appended = IF array::len($ch) > 0 THEN (
       UPDATE $ownerId SET channelIds += $ch[0].id, updatedAt = time::now()
     ) ELSE {} END;
     IF array::len($ch) > 0 THEN (SELECT * FROM $ch[0].id) ELSE {} END;`,
    {
      ownerId: rid(params.ownerId),
      type: params.type,
      value: params.value,
      verified,
      maxPerOwner: params.maxPerOwner,
    },
  );
  const last = result[result.length - 1];
  if (Array.isArray(last)) {
    return (last as EntityChannel[])[0] ?? null;
  }
  return last != null ? (last as EntityChannel) : null;
}

/** Flips the listed channels to `verified = true`. */
export async function verifyChannels(channelIds: string[]): Promise<void> {
  if (channelIds.length === 0) return;
  const db = await getDb();
  await db.query(
    `UPDATE entity_channel SET verified = true, updatedAt = time::now()
     WHERE id IN $ids`,
    { ids: channelIds.map((id) => rid(id)) },
  );
}

/**
 * Deletes an entity_channel and removes its id from the parent's `channelIds`
 * array in one batched query. The parent's table is resolved by `ownerKind`.
 */
export async function deleteChannel(params: {
  channelId: string;
  ownerId: string;
  ownerKind: EntityChannelOwnerKind;
}): Promise<void> {
  const db = await getDb();
  void ownerTable(params.ownerKind);
  await db.query(
    `UPDATE $ownerId SET
        channelIds = set::difference(channelIds, {$channelId}),
        updatedAt = time::now();
     DELETE $channelId;`,
    {
      ownerId: rid(params.ownerId),
      channelId: rid(params.channelId),
    },
  );
}

// ChannelOwnerMatch is now in @/src/contracts/high_level/query-results

/**
 * Batched conflict-detection helper for registration/invite flows. Given a
 * list of submitted `(type, value)` pairs and the target `ownerKind`, returns
 * every matching `entity_channel` paired with the parent that references it,
 * all in a single batched `db.query()` call.
 */
export async function findChannelOwners(
  pairs: { type: string; value: string }[],
  ownerKind: EntityChannelOwnerKind,
): Promise<ChannelOwnerMatch[]> {
  if (pairs.length === 0) return [];
  const db = await getDb();
  const table = ownerTable(ownerKind);
  const types = Array.from(new Set(pairs.map((p) => p.type)));
  const values = Array.from(new Set(pairs.map((p) => p.value)));
  const pairKey = (t: string, v: string) => `${t} ${v}`;
  const wanted = new Set(pairs.map((p) => pairKey(p.type, p.value)));

  const result = await db.query<unknown[]>(
    `LET $chs = (SELECT id, type, value, verified FROM entity_channel
                  WHERE type IN $types AND value IN $values);
     LET $chIds = $chs.id;
     LET $owners = IF array::len($chIds) = 0
                   THEN {}
                   ELSE (SELECT id, channelIds FROM ${table}
                          WHERE channelIds ANYINSIDE $chIds)
                   END;
     [{ channels: $chs, owners: $owners }];`,
    { types, values },
  );

  const last = result[result.length - 1] as
    | {
      channels: {
        id: unknown;
        type: string;
        value: string;
        verified: boolean;
      }[];
      owners: { id: unknown; channelIds: unknown[] }[];
    }[]
    | undefined;
  const payload = last?.[0];
  if (!payload) return [];

  const channelToOwner = new Map<string, string>();
  for (const owner of payload.owners) {
    const ownerId = normalizeRecordId(owner.id);
    if (!ownerId) continue;
    for (const cid of owner.channelIds ?? []) {
      const normalized = normalizeRecordId(cid);
      if (normalized) channelToOwner.set(normalized, ownerId);
    }
  }

  const matches: ChannelOwnerMatch[] = [];
  for (const ch of payload.channels) {
    if (!wanted.has(pairKey(ch.type, ch.value))) continue;
    const chId = normalizeRecordId(ch.id);
    if (!chId) continue;
    const ownerId = channelToOwner.get(chId);
    if (!ownerId) continue;
    matches.push({
      ownerId,
      channelId: chId,
      type: ch.type,
      value: ch.value,
      verified: ch.verified,
    });
  }
  return matches;
}

/**
 * Checks whether each of the given user ids has an **active, non-expired**
 * `verification_request` for a given `actionKey`. Returns the set of user ids
 * that do. Batched into one query.
 */
export async function findUsersWithPendingVerification(
  userIds: string[],
  actionKey: string,
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const db = await getDb();
  const result = await db.query<[{ ownerId: unknown }[]]>(
    `SELECT ownerId FROM verification_request
     WHERE ownerId IN $ownerIds
       AND actionKey = $actionKey
       AND usedAt IS NONE
       AND expiresAt > time::now()
     GROUP BY ownerId`,
    {
      ownerIds: userIds.map((id) => rid(id)),
      actionKey,
    },
  );
  const rows = result[0] ?? [];
  const out = new Set<string>();
  for (const r of rows) {
    const id = normalizeRecordId(r.ownerId);
    if (id) out.add(id);
  }
  return out;
}

/**
 * Given a raw channel value, finds the `user` (or `lead`) whose `channelIds`
 * array contains a **verified** entity_channel with that value.
 */
export async function findVerifiedOwnerByChannelValue(
  value: string,
): Promise<
  | {
    channel: EntityChannel;
    ownerId: string;
    ownerKind: EntityChannelOwnerKind;
  }
  | null
> {
  const db = await getDb();
  const result = await db.query<unknown[]>(
    `LET $chs   = (SELECT * FROM entity_channel
                    WHERE value = $value AND verified = true LIMIT 1);
     LET $ch    = $chs[0];
     LET $chId  = IF $ch = NONE THEN NONE ELSE $ch.id END;
     LET $uHit  = IF $chId = NONE
                  THEN {}
                  ELSE (SELECT id FROM user WHERE channelIds CONTAINS $chId LIMIT 1)
                  END;
     LET $lHit  = IF $chId = NONE OR array::len($uHit) > 0
                  THEN {}
                  ELSE (SELECT id FROM lead WHERE channelIds CONTAINS $chId LIMIT 1)
                  END;
     IF array::len($uHit) > 0
       THEN [{ id: $uHit[0].id, ownerKind: "user", channel: $ch }]
       ELSE (IF array::len($lHit) > 0
         THEN [{ id: $lHit[0].id, ownerKind: "lead", channel: $ch }]
         ELSE []
       END)
     END;`,
    { value },
  );
  const last = result[result.length - 1] as
    | {
      id: string;
      ownerKind: EntityChannelOwnerKind;
      channel: EntityChannel;
    }[]
    | undefined;
  const row = last?.[0];
  if (!row) return null;
  return {
    channel: row.channel,
    ownerId: String(row.id),
    ownerKind: row.ownerKind,
  };
}

/**
 * Same as {@link findVerifiedOwnerByChannelValue} but requires the channel
 * type to also match.
 */
export async function findVerifiedOwnerByTypedChannel(
  type: string,
  value: string,
): Promise<
  | {
    channel: EntityChannel;
    ownerId: string;
    ownerKind: EntityChannelOwnerKind;
  }
  | null
> {
  const db = await getDb();
  const result = await db.query<unknown[]>(
    `LET $chs   = (SELECT * FROM entity_channel
                    WHERE type = $type AND value = $value AND verified = true
                    LIMIT 1);
     LET $ch    = $chs[0];
     LET $chId  = IF $ch = NONE THEN NONE ELSE $ch.id END;
     LET $uHit  = IF $chId = NONE
                  THEN {}
                  ELSE (SELECT id FROM user WHERE channelIds CONTAINS $chId LIMIT 1)
                  END;
     LET $lHit  = IF $chId = NONE OR array::len($uHit) > 0
                  THEN {}
                  ELSE (SELECT id FROM lead WHERE channelIds CONTAINS $chId LIMIT 1)
                  END;
     IF array::len($uHit) > 0
       THEN [{ id: $uHit[0].id, ownerKind: "user", channel: $ch }]
       ELSE (IF array::len($lHit) > 0
         THEN [{ id: $lHit[0].id, ownerKind: "lead", channel: $ch }]
         ELSE []
       END)
     END;`,
    { type, value },
  );
  const last = result[result.length - 1] as
    | {
      id: string;
      ownerKind: EntityChannelOwnerKind;
      channel: EntityChannel;
    }[]
    | undefined;
  const row = last?.[0];
  if (!row) return null;
  return {
    channel: row.channel,
    ownerId: String(row.id),
    ownerKind: row.ownerKind,
  };
}

/** Finds an existing channel for a given owner with the same (type, value). */
export async function findChannelByOwnerTypeAndValue(
  ownerId: string,
  ownerKind: EntityChannelOwnerKind,
  type: string,
  value: string,
): Promise<EntityChannel | null> {
  const db = await getDb();
  const table = ownerTable(ownerKind);
  const result = await db.query<unknown[]>(
    `LET $owner = (SELECT channelIds FROM ${table} WHERE id = $ownerId)[0];
     LET $ids   = IF $owner = NONE THEN {} ELSE $owner.channelIds END;
     SELECT * FROM entity_channel
     WHERE id IN $ids AND type = $type AND value = $value
     LIMIT 1;`,
    { ownerId: rid(ownerId), type, value },
  );
  const last = result[result.length - 1] as EntityChannel[] | undefined;
  return last?.[0] ?? null;
}

/** Returns the distinct types of verified channels belonging to the owner. */
export async function listVerifiedChannelTypes(
  ownerId: string,
  ownerKind: EntityChannelOwnerKind,
): Promise<string[]> {
  const db = await getDb();
  const table = ownerTable(ownerKind);
  const result = await db.query<unknown[]>(
    `LET $owner = (SELECT channelIds FROM ${table} WHERE id = $ownerId)[0];
     LET $ids   = IF $owner = NONE THEN {} ELSE $owner.channelIds END;
     SELECT type FROM entity_channel
     WHERE id IN $ids AND verified = true
     GROUP BY type;`,
    { ownerId: rid(ownerId) },
  );
  const last = result[result.length - 1] as { type: string }[] | undefined;
  return (last ?? []).map((r) => r.type);
}

/** Counts verified channels of a given type belonging to the owner. */
export async function countVerifiedChannelsOfType(
  ownerId: string,
  ownerKind: EntityChannelOwnerKind,
  type: string,
): Promise<number> {
  const db = await getDb();
  const table = ownerTable(ownerKind);
  const result = await db.query<unknown[]>(
    `LET $owner = (SELECT channelIds FROM ${table} WHERE id = $ownerId)[0];
     LET $ids   = IF $owner = NONE THEN {} ELSE $owner.channelIds END;
     SELECT count() AS c FROM entity_channel
     WHERE id IN $ids AND type = $type AND verified = true
     GROUP ALL;`,
    { ownerId: rid(ownerId), type },
  );
  const last = result[result.length - 1] as { c: number }[] | undefined;
  return last?.[0]?.c ?? 0;
}

/**
 * Find a user's channel by (type, value) along with the owning user's id.
 * Used by the resend-verification flow to locate the unverified channel
 * belonging to a user given the raw identifier the user typed.
 */
export async function findUserChannelByTypeValue(
  type: string | undefined,
  value: string,
): Promise<{ id: string; ownerId: string; verified: boolean } | null> {
  const db = await getDb();
  const result = await db.query<unknown[]>(
    `LET $chIds = (SELECT VALUE id FROM entity_channel
                    WHERE type = $type AND value = $value);
     LET $users = IF array::len($chIds) = 0
                  THEN {}
                  ELSE (SELECT id, channelIds FROM user
                        WHERE channelIds ANYINSIDE $chIds)
                  END;
     LET $u = $users[0];
     LET $match = IF $u = NONE
                  THEN NONE
                  ELSE (SELECT id, verified FROM entity_channel
                        WHERE id IN $u.channelIds
                          AND type = $type AND value = $value
                        LIMIT 1)[0]
                  END;
     IF $match = NONE
       THEN {}
       ELSE {{ id: $match.id, ownerId: $u.id, verified: $match.verified },}
     END;`,
    { type, value },
  );
  const last = result[result.length - 1] as
    | { id: string; ownerId: string; verified: boolean }[]
    | undefined;
  return last?.[0] ?? null;
}
