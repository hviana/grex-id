import { createEventAndDelivery } from "../db/queries/event-queue.ts";
import { assertServerOnly } from "../utils/server-only.ts";

assertServerOnly("publisher");

/**
 * Publish an event to the queue. The event name is also the handler name
 * (§14.3) — a single delivery row is created for that handler.
 */
export async function publish(
  name: string,
  payload: Record<string, unknown>,
  availableAt?: Date,
): Promise<string> {
  const available = availableAt ?? new Date();
  return createEventAndDelivery(name, payload, available);
}
