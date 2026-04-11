import { getDb, rid } from "../db/connection.ts";
import { publish } from "../event-queue/publisher.ts";

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
 * Attempts to consume credits for an operation.
 *
 * Deduction priority:
 * 1. Plan credits (subscription.remainingPlanCredits) — temporary, per-period
 * 2. Purchased credits (usage_record with resource="credits") — persistent
 *
 * If insufficient credits in both sources combined, publishes an
 * "insufficient credits" email alert (once per exhaustion cycle via
 * creditAlertSent flag).
 *
 * Also records the expense in the credit_expense daily container for
 * usage reporting.
 */
export async function consumeCredits(params: {
  resourceKey: string;
  amount: number;
  companyId: string;
  systemId: string;
}): Promise<CreditDeductionResult> {
  const db = await getDb();
  const day = getCurrentDay();

  // Fetch subscription + purchased balance in a single query
  const result = await db.query<
    [
      {
        id: string;
        remainingPlanCredits: number;
        creditAlertSent: boolean;
        companyId: string;
        systemId: string;
      }[],
      { balance: number }[],
    ]
  >(
    `SELECT id, remainingPlanCredits, creditAlertSent, companyId, systemId
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
    if (!sub.creditAlertSent) {
      // Set flag and send alert email — single query
      await db.query(
        `UPDATE $subId SET creditAlertSent = true`,
        { subId: rid(sub.id) },
      );

      // Fetch company name + user email for the alert
      const info = await db.query<
        [
          { name: string; ownerId: string }[],
          { email: string; profile: { name: string } }[],
        ]
      >(
        `SELECT name, ownerId FROM company WHERE id = $companyId LIMIT 1;
         LET $comp = (SELECT ownerId FROM company WHERE id = $companyId LIMIT 1);
         SELECT email, profile.name AS name FROM user WHERE id = $comp[0].ownerId LIMIT 1 FETCH profile;`,
        { companyId: rid(params.companyId) },
      );

      const company = info[0]?.[0];
      const user = (info as unknown[])[2] as
        | { email: string; name: string }[]
        | undefined;
      const ownerEmail = user?.[0]?.email;
      const ownerName = user?.[0]?.name ?? company?.name ?? "";

      if (ownerEmail) {
        // Fetch system name for the email
        const sysResult = await db.query<[{ name: string; slug: string }[]]>(
          `SELECT name, slug FROM system WHERE id = $systemId LIMIT 1`,
          { systemId: rid(params.systemId) },
        );
        const systemName = sysResult[0]?.[0]?.name ?? "";
        const systemSlug = sysResult[0]?.[0]?.slug ?? "";

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
    // All from plan credits
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
 * Used by trackCreditExpense() for backward compatibility.
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
