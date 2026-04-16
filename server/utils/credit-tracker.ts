import { getDb, rid } from "../db/connection.ts";
import { publish } from "../event-queue/publisher.ts";
import type { Tenant } from "@/src/contracts/tenant.ts";

if (typeof window !== "undefined") {
  throw new Error(
    "credit-tracker.ts must not be imported in client-side code.",
  );
}

function getCurrentDay(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export interface CreditDeductionResult {
  success: boolean;
  source: "plan" | "purchased" | "insufficient";
  remainingPlanCredits?: number;
  remainingPurchasedCredits?: number;
}

/**
 * Attempts to consume credits for an operation (§22.3).
 *
 * Deduction priority:
 * 1. Plan credits (subscription.remainingPlanCredits) — temporary, per-period
 * 2. Purchased credits (usage_record with resource="credits") — persistent
 *
 * All DB lookups batched into single queries per logical step (§7.2).
 */
export async function consumeCredits(params: {
  resourceKey: string;
  amount: number;
  companyId: string;
  systemId: string;
  tenant: Tenant;
}): Promise<CreditDeductionResult> {
  const db = await getDb();
  const day = getCurrentDay();

  // Batch: subscription + purchased credit balance in one call
  const result = await db.query<
    [
      {
        id: string;
        remainingPlanCredits: number;
        creditAlertSent: boolean;
        autoRechargeEnabled: boolean;
        autoRechargeAmount: number;
        autoRechargeInProgress: boolean;
        companyId: string;
        systemId: string;
      }[],
      { balance: number }[],
    ]
  >(
    `SELECT id, remainingPlanCredits, creditAlertSent,
            autoRechargeEnabled, autoRechargeAmount, autoRechargeInProgress,
            companyId, systemId
     FROM subscription
     WHERE companyId = $companyId AND systemId = $systemId AND status = "active"
     LIMIT 1;
     SELECT math::sum(value) AS balance FROM usage_record
     WHERE companyId = $companyId AND systemId = $systemId AND resource = "credits"
     GROUP ALL;`,
    {
      companyId: rid(params.companyId),
      systemId: rid(params.systemId),
    },
  );

  const sub = result[0]?.[0];
  if (!sub) {
    return { success: false, source: "insufficient" };
  }

  const planCredits = sub.remainingPlanCredits ?? 0;
  const purchasedCredits = result[1]?.[0]?.balance ?? 0;
  const totalAvailable = planCredits + purchasedCredits;

  // Insufficient credits
  if (totalAvailable < params.amount) {
    // Try auto-recharge first
    if (
      sub.autoRechargeEnabled === true &&
      sub.autoRechargeInProgress === false
    ) {
      // Set re-entrancy guard
      await db.query(
        `UPDATE $subId SET autoRechargeInProgress = true`,
        { subId: rid(sub.id) },
      );

      await publish("TRIGGER_AUTO_RECHARGE", {
        subscriptionId: String(sub.id),
        companyId: String(sub.companyId),
        systemId: String(sub.systemId),
        resourceKey: params.resourceKey,
      });

      return { success: false, source: "insufficient" };
    }

    // No auto-recharge or already in progress — send alert (once per cycle)
    if (!sub.creditAlertSent) {
      // Batch: alert flag + company owner info + system info in one call
      const alertResult = await db.query<
        [
          unknown[],
          { name: string; ownerId: string }[],
          { email: string; name: string }[],
          { name: string; slug: string }[],
        ]
      >(
        `UPDATE $subId SET creditAlertSent = true;
         SELECT name, ownerId FROM company WHERE id = $companyId LIMIT 1;
         LET $ownerId = (SELECT VALUE ownerId FROM company WHERE id = $companyId LIMIT 1)[0];
         SELECT email, profile.name AS name FROM user WHERE id = $ownerId LIMIT 1 FETCH profile;
         SELECT name, slug FROM system WHERE id = $systemId LIMIT 1;`,
        {
          subId: rid(sub.id),
          companyId: rid(params.companyId),
          systemId: rid(params.systemId),
        },
      );

      const user = alertResult[2]?.[0];
      const ownerEmail = user?.email;
      const ownerName = user?.name ?? "";
      const systemName = alertResult[3]?.[0]?.name ?? "";
      const systemSlug = alertResult[3]?.[0]?.slug ?? "";

      if (ownerEmail) {
        await publish("SEND_EMAIL", {
          recipients: [ownerEmail],
          template: "insufficient-credit",
          templateData: {
            name: ownerName,
            systemName,
            resourceKey: params.resourceKey,
            purchaseLink: `/billing?system=${systemSlug}`,
          },
          systemSlug,
        });
      }
    }

    return { success: false, source: "insufficient" };
  }

  // Deduct: plan credits first, then purchased
  if (planCredits >= params.amount) {
    await db.query(
      `UPDATE $subId SET remainingPlanCredits -= $amount;
       UPSERT credit_expense SET
         companyId = $companyId, systemId = $systemId,
         resourceKey = $resourceKey, amount += $amount, day = $day
       WHERE companyId = $companyId AND systemId = $systemId
         AND resourceKey = $resourceKey AND day = $day;`,
      {
        subId: rid(sub.id),
        amount: params.amount,
        companyId: rid(params.companyId),
        systemId: rid(params.systemId),
        resourceKey: params.resourceKey,
        day,
      },
    );

    return {
      success: true,
      source: "plan",
      remainingPlanCredits: planCredits - params.amount,
      remainingPurchasedCredits: purchasedCredits,
    };
  }

  // Split: use all plan credits + remainder from purchased
  const fromPurchased = params.amount - planCredits;

  await db.query(
    `UPDATE $subId SET remainingPlanCredits = 0;
     UPSERT usage_record SET
       actorType = "user", actorId = "system",
       companyId = $companyId, systemId = $systemId,
       resource = "credits", value -= $fromPurchased, period = $period
     WHERE companyId = $companyId AND systemId = $systemId
       AND resource = "credits";
     UPSERT credit_expense SET
       companyId = $companyId, systemId = $systemId,
       resourceKey = $resourceKey, amount += $totalAmount, day = $day
     WHERE companyId = $companyId AND systemId = $systemId
       AND resourceKey = $resourceKey AND day = $day;`,
    {
      subId: rid(sub.id),
      companyId: rid(params.companyId),
      systemId: rid(params.systemId),
      fromPurchased,
      totalAmount: params.amount,
      resourceKey: params.resourceKey,
      day,
      period: `${new Date().getFullYear()}-${
        String(new Date().getMonth() + 1).padStart(2, "0")
      }`,
    },
  );

  return {
    success: true,
    source: "purchased",
    remainingPlanCredits: 0,
    remainingPurchasedCredits: purchasedCredits - fromPurchased,
  };
}

/**
 * Records a credit expense for reporting purposes only (no deduction).
 */
export async function trackCreditExpense(params: {
  resourceKey: string;
  amount: number;
  companyId: string;
  systemId: string;
}): Promise<void> {
  const db = await getDb();
  const day = getCurrentDay();

  await db.query(
    `UPSERT credit_expense SET
      companyId = $companyId,
      systemId = $systemId,
      resourceKey = $resourceKey,
      amount += $amount,
      day = $day
    WHERE companyId = $companyId
      AND systemId = $systemId
      AND resourceKey = $resourceKey
      AND day = $day`,
    {
      companyId: rid(params.companyId),
      systemId: rid(params.systemId),
      resourceKey: params.resourceKey,
      amount: params.amount,
      day,
    },
  );
}

/**
 * Queries aggregated credit expenses for a company+system within a date range.
 */
export async function getCreditExpenses(params: {
  companyId: string;
  systemId: string;
  startDate: string;
  endDate: string;
}): Promise<{ resourceKey: string; totalAmount: number }[]> {
  const db = await getDb();

  const result = await db.query<
    [{ resourceKey: string; totalAmount: number }[]]
  >(
    `SELECT resourceKey, math::sum(amount) AS totalAmount
     FROM credit_expense
     WHERE companyId = $companyId
       AND systemId = $systemId
       AND day >= $startDate
       AND day <= $endDate
     GROUP BY resourceKey
     ORDER BY totalAmount DESC`,
    {
      companyId: rid(params.companyId),
      systemId: rid(params.systemId),
      startDate: params.startDate,
      endDate: params.endDate,
    },
  );

  return result[0] ?? [];
}
