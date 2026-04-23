import { getDueSubscriptions } from "../db/queries/billing.ts";
import { publish } from "../event-queue/publisher.ts";
import { assertServerOnly } from "../utils/server-only.ts";

assertServerOnly("recurring-billing");

const BILLING_CHECK_INTERVAL_MS = 3_600_000; // 1 hour

export function startRecurringBilling(): void {
  async function checkDueSubscriptions() {
    try {
      const subs = await getDueSubscriptions();

      if (subs.length === 0) return;

      console.log(`[billing] Found ${subs.length} due subscriptions.`);

      for (const sub of subs) {
        await publish("process_payment", {
          subscriptionId: sub.id,
          companyId: sub.companyId,
          systemId: sub.systemId,
          planId: sub.planId,
          paymentMethodId: sub.paymentMethodId,
        });
      }
    } catch (err) {
      console.error("[billing] Error checking due subscriptions:", err);
    }
  }

  setInterval(checkDueSubscriptions, BILLING_CHECK_INTERVAL_MS);
  console.log("[billing] Recurring billing job started (hourly check).");
}
