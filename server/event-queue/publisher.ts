import { getDb } from "../db/connection.ts";
import { getHandlersForEvent } from "./registry.ts";

export async function publish(
  name: string,
  payload: Record<string, unknown>,
  availableAt?: Date,
): Promise<string> {
  const db = await getDb();
  const handlers = getHandlersForEvent(name);
  const available = availableAt ?? new Date();

  // Build a single batched query: create event + all deliveries in one call
  const deliveryStatements = handlers
    .map(
      (_, i) =>
        `CREATE delivery SET
          eventId = $eventId,
          handler = $handler_${i},
          status = "pending",
          availableAt = $availableAt,
          maxAttempts = 5`,
    )
    .join(";\n");

  const bindings: Record<string, unknown> = {
    name,
    payload,
    availableAt: available,
  };

  // Add handler bindings
  handlers.forEach((h, i) => {
    bindings[`handler_${i}`] = h;
  });

  const fullQuery = `LET $event = (CREATE queue_event SET
    name = $name,
    payload = $payload,
    availableAt = $availableAt RETURN id);
  LET $eventId = $event[0].id;
  ${deliveryStatements};
`;

  const result = await db.query<[{ id: string }[]]>(fullQuery, bindings);

  // The event ID is in the first result set
  const eventId = result[0]?.[0]?.id ?? String(result[0]);
  return eventId;
}
