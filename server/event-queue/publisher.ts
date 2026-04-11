import { getDb } from "../db/connection";
import { getHandlersForEvent } from "./registry";

export async function publish(
  name: string,
  payload: Record<string, unknown>,
  availableAt?: Date,
): Promise<string> {
  const db = await getDb();

  const result = await db.query<[{ id: string }[]]>(
    `CREATE queue_event SET
      name = $name,
      payload = $payload,
      availableAt = $availableAt`,
    {
      name,
      payload,
      availableAt: availableAt ?? new Date(),
    },
  );

  const eventId = result[0][0].id;
  const handlers = getHandlersForEvent(name);

  for (const handler of handlers) {
    await db.query(
      `CREATE delivery SET
        eventId = $eventId,
        handler = $handler,
        status = "pending",
        availableAt = $availableAt,
        maxAttempts = 5`,
      {
        eventId,
        handler,
        availableAt: availableAt ?? new Date(),
      },
    );
  }

  return eventId;
}
