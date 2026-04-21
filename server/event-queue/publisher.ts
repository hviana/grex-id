import { getDb } from "../db/connection.ts";

/**
 * Publish an event to the queue. The event name is also the handler name
 * (§14.3) — a single delivery row is created for that handler.
 */
export async function publish(
  name: string,
  payload: Record<string, unknown>,
  availableAt?: Date,
): Promise<string> {
  const db = await getDb();
  const available = availableAt ?? new Date();

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
    { name, payload, availableAt: available },
  );

  return result[2]?.[0]?.id ?? "";
}
