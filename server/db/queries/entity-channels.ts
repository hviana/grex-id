import { getDb, rid } from "../connection.ts";
import type { EntityChannel } from "@/src/contracts/entity-channel";

/**
 * Owner type for query-layer operations. `entity_channel` rows themselves have
 * no owner field — the owner is the parent whose `channels` array references
 * the row. These helpers accept the owner's (user|lead) id and the kind so
 * they know which parent array to read/mutate.
 */
export type EntityChannelOwnerKind = "user" | "lead";

function ownerTable(kind: EntityChannelOwnerKind): string {
  return kind;
}

/** Returns the channels referenced by the given user|lead, ordered by creation. */
export async function listChannelsByOwner(
  ownerId: string,
  kind: EntityChannelOwnerKind,
): Promise<EntityChannel[]> {
  const db = await getDb();
  const result = await db.query<[{ channels: EntityChannel[] }[]]>(
    `SELECT channels FROM ${ownerTable(kind)}
     WHERE id = $ownerId
     FETCH channels`,
    { ownerId: rid(ownerId) },
  );
  const row = result[0]?.[0];
  if (!row) return [];
  const chans = (row.channels ?? []) as EntityChannel[];
  return [...chans].sort((a, b) => {
    const ca = a?.createdAt ?? "";
    const cb = b?.createdAt ?? "";
    return ca < cb ? -1 : ca > cb ? 1 : 0;
  });
}

/**
 * Atomically creates an `entity_channel` row and appends its id to the
 * parent's `channels` array, respecting the `maxPerOwner` cap. Returns the
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
  const result = await db.query<[null, null, null, EntityChannel[]]>(
    `LET $owner = (SELECT id, channels FROM ${table} WHERE id = $ownerId)[0];
     LET $count = IF $owner = NONE THEN NONE ELSE array::len($owner.channels) END;
     LET $ch = IF ($count != NONE AND $count < $maxPerOwner) THEN (
       CREATE entity_channel SET
         type = $type,
         value = $value,
         verified = $verified
     ) ELSE [] END;
     IF array::len($ch) > 0 {
       UPDATE $ownerId SET channels += $ch[0].id, updatedAt = time::now();
     };
     SELECT * FROM $ch[0].id;`,
    {
      ownerId: rid(params.ownerId),
      type: params.type,
      value: params.value,
      verified,
      maxPerOwner: params.maxPerOwner,
    },
  );
  return result[3]?.[0] ?? null;
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
 * Deletes an entity_channel and removes its id from the parent's `channels`
 * array in one batched query. The parent's table is resolved by `ownerKind`.
 */
export async function deleteChannel(params: {
  channelId: string;
  ownerId: string;
  ownerKind: EntityChannelOwnerKind;
}): Promise<void> {
  const db = await getDb();
  const table = ownerTable(params.ownerKind);
  await db.query(
    `UPDATE $ownerId SET
        channels = channels.filter(|c| c != $channelId),
        updatedAt = time::now();
     DELETE $channelId;`,
    {
      ownerId: rid(params.ownerId),
      channelId: rid(params.channelId),
      // table is baked into the update target above (UPDATE $ownerId); the
      // table variable is kept here for query-reader clarity.
    },
  );
  void table;
}

/** Fetches a single channel by id. */
export async function findChannelById(
  channelId: string,
): Promise<EntityChannel | null> {
  const db = await getDb();
  const result = await db.query<[EntityChannel[]]>(
    `SELECT * FROM $id`,
    { id: rid(channelId) },
  );
  return result[0]?.[0] ?? null;
}

/** Returns every entity_channel row with a given (type, value). */
export async function findChannelsByTypeAndValue(
  type: string,
  value: string,
): Promise<EntityChannel[]> {
  const db = await getDb();
  const result = await db.query<[EntityChannel[]]>(
    `SELECT * FROM entity_channel WHERE type = $type AND value = $value`,
    { type, value },
  );
  return result[0] ?? [];
}

/**
 * Given a raw channel value, finds the `user` (or `lead`) whose `channels`
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
  const result = await db.query<
    [
      {
        id: string;
        ownerKind: EntityChannelOwnerKind;
        channel: EntityChannel;
      }[],
    ]
  >(
    `LET $ch = (SELECT id FROM entity_channel
                WHERE value = $value AND verified = true LIMIT 1)[0];
     IF $ch = NONE { RETURN []; };
     LET $u = (SELECT id FROM user WHERE channels CONTAINS $ch.id LIMIT 1)[0];
     IF $u != NONE {
       RETURN [{ id: $u.id, ownerKind: "user", channel: (SELECT * FROM $ch.id)[0] }];
     };
     LET $l = (SELECT id FROM lead WHERE channels CONTAINS $ch.id LIMIT 1)[0];
     IF $l != NONE {
       RETURN [{ id: $l.id, ownerKind: "lead", channel: (SELECT * FROM $ch.id)[0] }];
     };
     RETURN [];`,
    { value },
  );
  const row = result[0]?.[0];
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
  const result = await db.query<
    [
      {
        id: string;
        ownerKind: EntityChannelOwnerKind;
        channel: EntityChannel;
      }[],
    ]
  >(
    `LET $ch = (SELECT id FROM entity_channel
                WHERE type = $type AND value = $value AND verified = true
                LIMIT 1)[0];
     IF $ch = NONE { RETURN []; };
     LET $u = (SELECT id FROM user WHERE channels CONTAINS $ch.id LIMIT 1)[0];
     IF $u != NONE {
       RETURN [{ id: $u.id, ownerKind: "user", channel: (SELECT * FROM $ch.id)[0] }];
     };
     LET $l = (SELECT id FROM lead WHERE channels CONTAINS $ch.id LIMIT 1)[0];
     IF $l != NONE {
       RETURN [{ id: $l.id, ownerKind: "lead", channel: (SELECT * FROM $ch.id)[0] }];
     };
     RETURN [];`,
    { type, value },
  );
  const row = result[0]?.[0];
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
  const result = await db.query<[EntityChannel[]]>(
    `LET $owner = (SELECT channels FROM ${table} WHERE id = $ownerId)[0];
     IF $owner = NONE { RETURN []; };
     SELECT * FROM entity_channel
     WHERE id IN $owner.channels AND type = $type AND value = $value
     LIMIT 1;`,
    { ownerId: rid(ownerId), type, value },
  );
  return result[0]?.[0] ?? null;
}

/** Returns the distinct types of verified channels belonging to the owner. */
export async function listVerifiedChannelTypes(
  ownerId: string,
  ownerKind: EntityChannelOwnerKind,
): Promise<string[]> {
  const db = await getDb();
  const table = ownerTable(ownerKind);
  const result = await db.query<[{ type: string }[]]>(
    `LET $owner = (SELECT channels FROM ${table} WHERE id = $ownerId)[0];
     IF $owner = NONE { RETURN []; };
     SELECT DISTINCT type FROM entity_channel
     WHERE id IN $owner.channels AND verified = true;`,
    { ownerId: rid(ownerId) },
  );
  return (result[0] ?? []).map((r) => r.type);
}

/** Counts verified channels of a given type belonging to the owner. */
export async function countVerifiedChannelsOfType(
  ownerId: string,
  ownerKind: EntityChannelOwnerKind,
  type: string,
): Promise<number> {
  const db = await getDb();
  const table = ownerTable(ownerKind);
  const result = await db.query<[{ c: number }[]]>(
    `LET $owner = (SELECT channels FROM ${table} WHERE id = $ownerId)[0];
     IF $owner = NONE { RETURN [{ c: 0 }]; };
     SELECT count() AS c FROM entity_channel
     WHERE id IN $owner.channels AND type = $type AND verified = true
     GROUP ALL;`,
    { ownerId: rid(ownerId), type },
  );
  return result[0]?.[0]?.c ?? 0;
}
