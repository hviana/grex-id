import { startEventQueue } from "./start-event-queue";
import { startRecurringBilling } from "./recurring-billing";

export async function startAllJobs(): Promise<void> {
  console.log("[jobs] Starting all background jobs...");
  startEventQueue();
  startRecurringBilling();
  console.log("[jobs] All jobs started.");
}
