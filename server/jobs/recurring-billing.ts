import "server-only";

import { genericList } from "../db/queries/generics.ts";
import type { Subscription } from "@/src/contracts/subscription";
import { publish } from "../event-queue/publisher.ts";

const BILLING_CHECK_INTERVAL_MS = 3_600_000; // 1 hour

export function startRecurringBilling(): void {
  async function checkDueSubscriptions() {
    try {
      const result = await genericList<Subscription>(
        {
          table: "subscription",
          extraConditions: [
            "status = 'active'",
            "currentPeriodEnd <= time::now()",
          ],
          extraAccessFields: ["status", "currentPeriodEnd"],
          allowRawExtraConditions: true,
          limit: 10000,
        },
      );
      const subs = result.items;

      if (subs.length === 0) return;

      console.log(`[billing] Found ${subs.length} due subscriptions.`);

      for (const sub of subs) {
        await publish("process_payment", {
          subscriptionId: sub.id,
          tenantId: (sub.tenantIds as unknown as string[])?.[0],
          planId: sub.planId as string,
          paymentMethodId: sub.paymentMethodId as string,
        });
      }
    } catch (err) {
      console.error("[billing] Error checking due subscriptions:", err);
    }
  }

  setInterval(checkDueSubscriptions, BILLING_CHECK_INTERVAL_MS);
  console.log("[billing] Recurring billing job started (hourly check).");
}
