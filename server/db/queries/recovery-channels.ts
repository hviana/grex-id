import { getDb, rid } from "../connection.ts";
import type {
  RecoveryChannel,
  RecoveryChannelType,
} from "@/src/contracts/recovery-channel";

export async function listRecoveryChannels(
  userId: string,
): Promise<RecoveryChannel[]> {
  const db = await getDb();
  const result = await db.query<[RecoveryChannel[]]>(
    `SELECT * FROM recovery_channel
     WHERE userId = $userId
     ORDER BY createdAt ASC`,
    { userId: rid(userId) },
  );
  return result[0] ?? [];
}

export async function createRecoveryChannel(params: {
  userId: string;
  type: RecoveryChannelType;
  value: string;
  maxPerUser: number;
}): Promise<RecoveryChannel | null> {
  const db = await getDb();
  const result = await db.query<[unknown, RecoveryChannel[]]>(
    `LET $count = (SELECT count() AS c FROM recovery_channel WHERE userId = $userId GROUP ALL)[0].c;
     IF $count < $maxPerUser {
       LET $ch = CREATE recovery_channel SET
         userId = $userId,
         type = $type,
         value = $value,
         verified = false;
       LET $prof = (SELECT profile FROM user WHERE id = $userId)[0].profile;
       UPDATE $prof SET recoveryChannels += $ch[0].id, updatedAt = time::now();
       SELECT * FROM $ch[0].id;
     };`,
    {
      userId: rid(params.userId),
      type: params.type,
      value: params.value,
      maxPerUser: params.maxPerUser,
    },
  );
  // The conditional block returns the channel as the last statement
  const channelResult = result[1];
  return channelResult?.[0] ?? null;
}

export async function verifyRecoveryChannel(
  channelId: string,
): Promise<void> {
  const db = await getDb();
  await db.query(
    "UPDATE $channelId SET verified = true, updatedAt = time::now()",
    { channelId: rid(channelId) },
  );
}

export async function deleteRecoveryChannel(
  channelId: string,
  userId: string,
): Promise<void> {
  const db = await getDb();
  await db.query(
    `LET $prof = (SELECT profile FROM user WHERE id = $userId)[0].profile;
     UPDATE $prof SET recoveryChannels = recoveryChannels.filter(|x| x != $channelId), updatedAt = time::now();
     DELETE $channelId;`,
    {
      channelId: rid(channelId),
      userId: rid(userId),
    },
  );
}

export async function findVerifiedRecoveryChannel(
  type: RecoveryChannelType,
  value: string,
): Promise<(RecoveryChannel & { userId: string }) | null> {
  const db = await getDb();
  const result = await db.query<[(RecoveryChannel & { userId: string })[]]>(
    `SELECT * FROM recovery_channel
     WHERE type = $type AND value = $value AND verified = true
     LIMIT 1`,
    { type, value },
  );
  return result[0]?.[0] ?? null;
}

export async function findRecoveryChannelById(
  channelId: string,
): Promise<RecoveryChannel | null> {
  const db = await getDb();
  const result = await db.query<[RecoveryChannel[]]>(
    "SELECT * FROM $channelId",
    { channelId: rid(channelId) },
  );
  return result[0]?.[0] ?? null;
}

export async function findRecoveryChannelByUserAndValue(
  userId: string,
  type: RecoveryChannelType,
  value: string,
): Promise<RecoveryChannel | null> {
  const db = await getDb();
  const result = await db.query<[RecoveryChannel[]]>(
    `SELECT * FROM recovery_channel
     WHERE userId = $userId AND type = $type AND value = $value
     LIMIT 1`,
    { userId: rid(userId), type, value },
  );
  return result[0]?.[0] ?? null;
}
