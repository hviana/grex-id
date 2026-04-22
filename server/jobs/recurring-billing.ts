import { getDb } from "../db/connection.ts";
import { publish } from "../event-queue/publisher.ts";
import { assertServerOnly } from "../utils/server-only.ts";

assertServerOnly("recurring-billing");

const BILLING_CHECK_INTERVAL_MS = 3_600_000; // 1 hour

export function startRecurringBilling(): void {
  async function checkDueSubscriptions() {
    try {
      const db = await getDb();

      const due = await db.query<[{
        id: string;
        companyId: string;
        systemId: string;
        planId: string;
        paymentMethodId: string;
        currentPeriodEnd: string;
      }[]]>(
        `SELECT * FROM subscription
         WHERE status = "active"
           AND currentPeriodEnd <= time::now()`,
      );

      const subs = due[0] ?? [];
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
