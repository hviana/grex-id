import { getDb, rid } from "../connection.ts";
import type { Delivery, QueueEvent } from "@/src/contracts/event-queue";
import { assertServerOnly } from "../../utils/server-only.ts";

assertServerOnly("event-queue");

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

// ─── Worker queries (§14.4) ──────────────────────────────────────────────────

export interface CandidateDelivery {
  id: string;
  eventId: string;
  attempts: number;
  maxAttempts: number;
}

export async function claimCandidateDeliveries(
  handler: string,
  limit: number,
): Promise<CandidateDelivery[]> {
  const db = await getDb();
  const result = await db.query<[CandidateDelivery[]]>(
    `SELECT id, eventId, attempts, maxAttempts, availableAt FROM delivery
     WHERE handler = $handler
       AND status = "pending"
       AND availableAt <= time::now()
       AND (leaseUntil IS NONE OR leaseUntil <= time::now())
     ORDER BY availableAt ASC
     LIMIT $limit`,
    { handler, limit },
  );
  return result[0] ?? [];
}

export async function leaseDelivery(
  id: string,
  leaseUntil: Date,
  workerId: string,
): Promise<boolean> {
  const db = await getDb();
  const updated = await db.query<[Record<string, unknown>[]]>(
    `UPDATE $id SET
      status = "processing",
      leaseUntil = $leaseUntil,
      workerId = $workerId,
      attempts = attempts + 1,
      startedAt = time::now()
    WHERE status = "pending"
    RETURN AFTER`,
    { id, leaseUntil, workerId },
  );
  return (updated[0]?.length ?? 0) > 0;
}

export async function getEventPayload(
  eventId: string,
): Promise<Record<string, unknown>> {
  const db = await getDb();
  const result = await db.query<[{ payload: Record<string, unknown> }[]]>(
    "SELECT payload FROM queue_event WHERE id = $eventId LIMIT 1",
    { eventId },
  );
  return result[0]?.[0]?.payload ?? {};
}

export async function markDeliveryDone(id: string): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE $id SET
      status = "done",
      leaseUntil = NONE,
      finishedAt = time::now(),
      lastError = NONE`,
    { id },
  );
}

export async function markDeliveryDead(
  id: string,
  error: string,
): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE $id SET
      status = "dead",
      leaseUntil = NONE,
      lastError = $error,
      finishedAt = time::now()`,
    { id, error },
  );
}

export async function retryDelivery(
  id: string,
  nextAvailable: Date,
  error: string,
): Promise<void> {
  const db = await getDb();
  await db.query(
    `UPDATE $id SET
      status = "pending",
      leaseUntil = NONE,
      availableAt = $nextAvailable,
      lastError = $error`,
    { id, nextAvailable, error },
  );
}

// ─── Publisher queries (§14.2) ───────────────────────────────────────────────

export async function createEventAndDelivery(
  name: string,
  payload: Record<string, unknown>,
  availableAt: Date,
): Promise<string> {
  const db = await getDb();
  const result = await db.query<[null, unknown[], { id: string }[]]>(
    `LET $event = (CREATE queue_event SET
      name = $name,
      payload = $payload,
      availableAt = $availableAt RETURN id);
     CREATE delivery SET
       eventId = $event[0].id,
       handler = $name,
       status = "pending",
       availableAt = $availableAt,
       maxAttempts = 5;
     SELECT id FROM $event[0].id;`,
    { name, payload, availableAt },
  );
  return result[2]?.[0]?.id ?? "";
}
