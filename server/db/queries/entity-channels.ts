import { getDb, rid } from "../connection.ts";
import type {
  EntityChannel,
  EntityChannelOwnerType,
} from "@/src/contracts/entity-channel";

export async function listChannelsByOwner(
  ownerId: string,
): Promise<EntityChannel[]> {
  const db = await getDb();
  const result = await db.query<[EntityChannel[]]>(
    `SELECT * FROM entity_channel
     WHERE ownerId = $ownerId
     ORDER BY createdAt ASC`,
    { ownerId: rid(ownerId) },
  );
  return result[0] ?? [];
}

export async function createChannel(params: {
  ownerId: string;
  ownerType: EntityChannelOwnerType;
  type: string;
  value: string;
  verified?: boolean;
  maxPerOwner: number;
  appendToProfileId?: string;
}): Promise<EntityChannel | null> {
  const db = await getDb();
  const verified = params.verified ?? false;
  const result = await db.query<[null, null, EntityChannel[]]>(
    `LET $count = (SELECT count() AS c FROM entity_channel WHERE ownerId = $ownerId GROUP ALL)[0].c;
     LET $ch = IF ($count = NONE OR $count < $maxPerOwner) THEN (
       CREATE entity_channel SET
         ownerId = $ownerId,
         ownerType = $ownerType,
         type = $type,
         value = $value,
         verified = $verified
     ) ELSE [] END;
     IF array::len($ch) > 0 AND $profileId != NONE {
       UPDATE $profileId SET channels += $ch[0].id, updatedAt = time::now();
     };
     SELECT * FROM $ch[0].id;`,
    {
      ownerId: rid(params.ownerId),
      ownerType: params.ownerType,
      type: params.type,
      value: params.value,
      verified,
      maxPerOwner: params.maxPerOwner,
      profileId: params.appendToProfileId
        ? rid(params.appendToProfileId)
        : undefined,
    },
  );
  return result[2]?.[0] ?? null;
}

export async function verifyChannels(channelIds: string[]): Promise<void> {
  if (channelIds.length === 0) return;
  const db = await getDb();
  await db.query(
    `UPDATE entity_channel SET verified = true, updatedAt = time::now()
     WHERE id IN $ids`,
    { ids: channelIds.map((id) => rid(id)) },
  );
}

export async function deleteChannel(params: {
  channelId: string;
  profileId?: string;
}): Promise<void> {
  const db = await getDb();
  const stmts = [
    params.profileId
      ? `UPDATE $profileId SET channels = channels.filter(|c| c != $channelId), updatedAt = time::now()`
      : null,
    `DELETE $channelId`,
  ].filter((s): s is string => !!s);
  await db.query(stmts.join(";\n") + ";", {
    channelId: rid(params.channelId),
    profileId: params.profileId ? rid(params.profileId) : undefined,
  });
}

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

export async function findVerifiedOwnerByChannelValue(
  value: string,
): Promise<
  | {
    channel: EntityChannel;
    ownerId: string;
    ownerType: EntityChannelOwnerType;
  }
  | null
> {
  const db = await getDb();
  const result = await db.query<[EntityChannel[]]>(
    `SELECT * FROM entity_channel WHERE value = $value AND verified = true LIMIT 1`,
    { value },
  );
  const row = result[0]?.[0];
  if (!row) return null;
  return {
    channel: row,
    ownerId: String(row.ownerId),
    ownerType: row.ownerType,
  };
}

export async function findVerifiedOwnerByTypedChannel(
  type: string,
  value: string,
): Promise<
  | {
    channel: EntityChannel;
    ownerId: string;
    ownerType: EntityChannelOwnerType;
  }
  | null
> {
  const db = await getDb();
  const result = await db.query<[EntityChannel[]]>(
    `SELECT * FROM entity_channel
     WHERE type = $type AND value = $value AND verified = true LIMIT 1`,
    { type, value },
  );
  const row = result[0]?.[0];
  if (!row) return null;
  return {
    channel: row,
    ownerId: String(row.ownerId),
    ownerType: row.ownerType,
  };
}

export async function findChannelByOwnerTypeAndValue(
  ownerId: string,
  type: string,
  value: string,
): Promise<EntityChannel | null> {
  const db = await getDb();
  const result = await db.query<[EntityChannel[]]>(
    `SELECT * FROM entity_channel
     WHERE ownerId = $ownerId AND type = $type AND value = $value
     LIMIT 1`,
    { ownerId: rid(ownerId), type, value },
  );
  return result[0]?.[0] ?? null;
}

export async function listVerifiedChannelTypes(
  ownerId: string,
): Promise<string[]> {
  const db = await getDb();
  const result = await db.query<[{ type: string }[]]>(
    `SELECT DISTINCT type FROM entity_channel
     WHERE ownerId = $ownerId AND verified = true`,
    { ownerId: rid(ownerId) },
  );
  return (result[0] ?? []).map((r) => r.type);
}

export async function countVerifiedChannelsOfType(
  ownerId: string,
  type: string,
): Promise<number> {
  const db = await getDb();
  const result = await db.query<[{ c: number }[]]>(
    `SELECT count() AS c FROM entity_channel
     WHERE ownerId = $ownerId AND type = $type AND verified = true
     GROUP ALL`,
    { ownerId: rid(ownerId), type },
  );
  return result[0]?.[0]?.c ?? 0;
}
