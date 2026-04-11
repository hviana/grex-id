import type { HandlerFn } from "../worker.ts";
import { getDb } from "../../db/connection.ts";

export const processPayment: HandlerFn = async (payload) => {
  const subscriptionId = payload.subscriptionId as string;
  const db = await getDb();

  const subs = await db.query<[{
    id: string;
    planId: string;
    paymentMethodId: string;
    companyId: string;
    currentPeriodEnd: string;
  }[]]>(
    "SELECT * FROM subscription WHERE id = $id LIMIT 1",
    { id: subscriptionId },
  );

  const sub = subs[0]?.[0];
  if (!sub) {
    console.log(
      `[payment] Subscription ${subscriptionId} not found, skipping.`,
    );
    return;
  }

  const plans = await db.query<
    [{ price: number; recurrenceDays: number; planCredits: number }[]]
  >(
    "SELECT price, recurrenceDays, planCredits FROM plan WHERE id = $planId LIMIT 1",
    { planId: sub.planId },
  );

  const plan = plans[0]?.[0];
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
        id: sub.id,
        newStart,
        newEnd,
        planCredits: plan.planCredits ?? 0,
      },
    );
  } else {
    await db.query(
      `UPDATE $id SET status = "past_due"`,
      { id: sub.id },
    );
  }
};
