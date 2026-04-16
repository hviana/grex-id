import { startEventQueue } from "./start-event-queue.ts";
import { startRecurringBilling } from "./recurring-billing.ts";
import { startTokenCleanup } from "./token-cleanup.ts";

export async function startAllJobs(): Promise<void> {
  console.log("[jobs] Starting all background jobs...");
  startEventQueue();
  startRecurringBilling();
  startTokenCleanup();
  console.log("[jobs] All jobs started.");
}
