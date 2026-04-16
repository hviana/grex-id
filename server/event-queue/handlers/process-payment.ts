import type { HandlerFn } from "../worker.ts";
import { getDb, rid } from "../../db/connection.ts";
import { publish } from "../publisher.ts";

export const processPayment: HandlerFn = async (payload) => {
  const subscriptionId = payload.subscriptionId as string;
  const db = await getDb();

  // Batch: subscription + plan in one call (§7.2)
  const result = await db.query<
    [
      {
        id: string;
        planId: string;
        paymentMethodId: string;
        companyId: string;
        systemId: string;
        currentPeriodEnd: string;
      }[],
      { price: number; recurrenceDays: number; planCredits: number }[],
    ]
  >(
    `SELECT * FROM subscription WHERE id = $id LIMIT 1;
     LET $planId = (SELECT VALUE planId FROM subscription WHERE id = $id LIMIT 1)[0];
     SELECT price, recurrenceDays, planCredits FROM plan WHERE id = $planId LIMIT 1;`,
    { id: rid(subscriptionId) },
  );

  const sub = result[0]?.[0];
  if (!sub) {
    console.log(
      `[payment] Subscription ${subscriptionId} not found, skipping.`,
    );
    return;
  }

  const plan = result[1]?.[0];
  if (!plan) return;

  // TODO: Call actual payment provider (Phase 6)
  // For now, simulate success
  const success = true;

  if (success) {
    const newStart = new Date(sub.currentPeriodEnd);
    const newEnd = new Date(
      newStart.getTime() + plan.recurrenceDays * 86400000,
    );

    await db.query(
      `UPDATE $id SET
        currentPeriodStart = $newStart,
        currentPeriodEnd = $newEnd,
        remainingPlanCredits = $planCredits,
        creditAlertSent = false`,
      {
        id: rid(sub.id),
        newStart,
        newEnd,
        planCredits: plan.planCredits ?? 0,
      },
    );
  } else {
    await db.query(
      `UPDATE $id SET status = "past_due"`,
      { id: rid(sub.id) },
    );
  }
};
