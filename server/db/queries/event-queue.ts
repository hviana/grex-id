import { getDb, rid } from "../connection";
import type { Delivery, QueueEvent } from "@/src/contracts/event-queue";

export async function getEventById(id: string): Promise<QueueEvent | null> {
  const db = await getDb();
  const result = await db.query<[QueueEvent[]]>(
    "SELECT * FROM queue_event WHERE id = $id LIMIT 1",
    { id: rid(id) },
  );
  return result[0]?.[0] ?? null;
}

export async function listDeadDeliveries(
  limit: number = 50,
): Promise<Delivery[]> {
  const db = await getDb();
  const result = await db.query<[Delivery[]]>(
    `SELECT * FROM delivery WHERE status = "dead" ORDER BY finishedAt DESC LIMIT $limit`,
    { limit },
  );
  return result[0] ?? [];
}

export async function retryDeadDelivery(id: string): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE $id SET
      status = "pending",
      attempts = 0,
      lastError = NONE,
      availableAt = time::now(),
      finishedAt = NONE`,
    { id: rid(id) },
  );
}

export async function getDeliveryStats(): Promise<Record<string, number>> {
  const db = await getDb();
  const result = await db.query<[{ status: string; count: number }[]]>(
    "SELECT status, count() AS count FROM delivery GROUP BY status",
  );

  const stats: Record<string, number> = {};
  for (const row of result[0] ?? []) {
    stats[row.status] = row.count;
  }
  return stats;
}
