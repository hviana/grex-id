import { getDb, rid } from "../db/connection.ts";
import { publish } from "../event-queue/publisher.ts";
import type { Tenant } from "@/src/contracts/tenant.ts";
import type { TenantActorType } from "@/src/contracts/tenant.ts";
import { resolveMaxOperationCount } from "./guards.ts";

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
  source: "plan" | "purchased" | "insufficient" | "operationLimit";
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
 * Operation-count cap (§22.3 step 4, per-resourceKey):
 * If remainingOperationCount[resourceKey] is 0 and the cap is active,
 * the operation is rejected regardless of available credits.
 * Actor-level cap (step 4a) enforced for api_token / connected_app actors.
 *
 * All DB lookups batched into single queries per logical step (§7.2).
 */
export async function consumeCredits(params: {
  resourceKey: string;
  amount: number;
  companyId: string;
  systemId: string;
  tenant: Tenant;
  actorId?: string;
  actorType?: TenantActorType;
}): Promise<CreditDeductionResult> {
  const db = await getDb();
  const day = getCurrentDay();

  // Single batched query: fetch subscription + credit balance + conditionally set
  // auto-recharge re-entrancy guard (§22.3, §7.2)
  const result = await db.query<
    [
      {
        id: string;
        remainingPlanCredits: number;
        remainingOperationCount: Record<string, number> | null;
        creditAlertSent: boolean;
        operationCountAlertSent: Record<string, boolean> | null;
        autoRechargeEnabled: boolean;
        autoRechargeAmount: number;
        autoRechargeInProgress: boolean;
        companyId: string;
        systemId: string;
        autoRechargeGuardSet: boolean;
      }[],
      { balance: number }[],
    ]
  >(
    `LET $sub = (SELECT id, remainingPlanCredits, remainingOperationCount, creditAlertSent, operationCountAlertSent,
            autoRechargeEnabled, autoRechargeAmount, autoRechargeInProgress,
            companyId, systemId
     FROM subscription
     WHERE companyId = $companyId AND systemId = $systemId AND status = "active"
     LIMIT 1)[0];
     IF $sub != NONE AND $sub.autoRechargeEnabled = true AND $sub.autoRechargeInProgress = false {
       UPDATE $sub.id SET autoRechargeInProgress = true;
     };
     SELECT id, remainingPlanCredits, remainingOperationCount, creditAlertSent, operationCountAlertSent,
            autoRechargeEnabled, autoRechargeAmount, autoRechargeInProgress,
            companyId, systemId,
            (IF autoRechargeEnabled = true AND autoRechargeInProgress = false THEN true ELSE false END) AS autoRechargeGuardSet
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

  // Per-resourceKey operation-count cap check (§12.3)
  const operationCounts: Record<string, number> =
    (sub.remainingOperationCount as Record<string, number>) ?? {};
  const remainingForThisKey = operationCounts[params.resourceKey] ?? 0;

  const opCap = await resolveMaxOperationCount({
    companyId: params.companyId,
    systemId: params.systemId,
    resourceKey: params.resourceKey,
  });

  if (opCap.max > 0 && remainingForThisKey === 0) {
    const rawAlertMap = sub.operationCountAlertSent;
    const alertMap: Record<string, boolean> =
      (typeof rawAlertMap === "object" && rawAlertMap !== null)
        ? rawAlertMap as Record<string, boolean>
        : {};
    if (!alertMap[params.resourceKey]) {
      await sendOperationCountAlert(sub, params, opCap.max);
    }
    return { success: false, source: "operationLimit" };
  }

  // Actor-level cap check (§22.3 step 4a) for api_token / connected_app
  if (
    params.actorId &&
    (params.actorType === "api_token" ||
      params.actorType === "connected_app")
  ) {
    const actorCapResult = await checkActorOperationCap({
      actorId: params.actorId,
      actorType: params.actorType ?? "user",
      resourceKey: params.resourceKey,
      companyId: params.companyId,
      systemId: params.systemId,
      db,
    });

    if (actorCapResult === "limited") {
      return { success: false, source: "operationLimit" };
    }
  }

  // Insufficient credits
  if (totalAvailable < params.amount) {
    // Auto-recharge guard was set atomically in the batched query above
    if (sub.autoRechargeGuardSet) {
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
      const alertResult = await db.query<
        [
          unknown[],
          { name: string; ownerId: string }[],
          { email: string; name: string; locale: string }[],
          { name: string; slug: string }[],
        ]
      >(
        `UPDATE $subId SET creditAlertSent = true;
         SELECT name, ownerId FROM company WHERE id = $companyId LIMIT 1;
         LET $ownerId = (SELECT VALUE ownerId FROM company WHERE id = $companyId LIMIT 1)[0];
         SELECT email, profile.name AS name, profile.locale AS locale FROM user WHERE id = $ownerId LIMIT 1 FETCH profile;
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
      const ownerLocale = user?.locale;
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
          locale: ownerLocale || undefined,
          systemSlug,
        });
      }
    }

    return { success: false, source: "insufficient" };
  }

  // Decrement per-resourceKey operation count on successful deduction
  const opCountMerge = opCap.max > 0
    ? { [params.resourceKey]: Math.max(0, remainingForThisKey - 1) }
    : null;

  // Deduct: plan credits first, then purchased
  if (planCredits >= params.amount) {
    await db.query(
      `UPDATE $subId SET remainingPlanCredits -= $amount${
        opCountMerge
          ? ", remainingOperationCount = object::merge(remainingOperationCount ?? {}, $opCountMerge)"
          : ""
      };
       UPSERT credit_expense SET
         companyId = $companyId, systemId = $systemId,
         resourceKey = $resourceKey, amount += $amount, count += 1, day = $day,
         actorId = $actorId
       WHERE companyId = $companyId AND systemId = $systemId
         AND resourceKey = $resourceKey AND day = $day;`,
      {
        subId: rid(sub.id),
        amount: params.amount,
        companyId: rid(params.companyId),
        systemId: rid(params.systemId),
        resourceKey: params.resourceKey,
        day,
        actorId: params.actorId ?? null,
        ...(opCountMerge ? { opCountMerge } : {}),
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
    `UPDATE $subId SET remainingPlanCredits = 0${
      opCountMerge
        ? ", remainingOperationCount = object::merge(remainingOperationCount ?? {}, $opCountMerge)"
        : ""
    };
     UPSERT usage_record SET
       actorType = "user", actorId = "system",
       companyId = $companyId, systemId = $systemId,
       resource = "credits", value -= $fromPurchased, period = $period
     WHERE companyId = $companyId AND systemId = $systemId
       AND resource = "credits";
     UPSERT credit_expense SET
       companyId = $companyId, systemId = $systemId,
       resourceKey = $resourceKey, amount += $totalAmount, count += 1, day = $day,
       actorId = $actorId
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
      actorId: params.actorId ?? null,
      period: `${new Date().getFullYear()}-${
        String(new Date().getMonth() + 1).padStart(2, "0")
      }`,
      ...(opCountMerge ? { opCountMerge } : {}),
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
 * Checks the actor-level per-resourceKey operation count cap.
 * Returns "limited" if the actor has hit their cap, "ok" otherwise.
 */
async function checkActorOperationCap(params: {
  actorId: string;
  actorType: string;
  resourceKey: string;
  companyId: string;
  systemId: string;
  db: Awaited<ReturnType<typeof getDb>>;
}): Promise<"ok" | "limited"> {
  const { actorId, actorType, resourceKey, companyId, systemId, db } = params;

  // Batched query: actor cap + expense count in one call (§7.2)
  // $actorRid for record ID lookup, $actorStr for credit_expense string match
  const actorQuery = actorType === "api_token"
    ? `SELECT VALUE maxOperationCount FROM api_token WHERE id = $actorRid LIMIT 1;`
    : `SELECT VALUE maxOperationCount FROM connected_app WHERE id = $actorRid LIMIT 1;`;

  const result = await db.query<
    [
      (Record<string, number> | null)[],
      { count: number }[],
    ]
  >(
    `${actorQuery}
     SELECT math::sum(count) AS count FROM credit_expense
     WHERE actorId = $actorStr
       AND resourceKey = $resourceKey
       AND companyId = $companyId
       AND systemId = $systemId
       AND day >= $periodStart
     GROUP ALL;`,
    {
      actorRid: rid(actorId),
      actorStr: actorId,
      resourceKey,
      companyId: rid(companyId),
      systemId: rid(systemId),
      periodStart: getCurrentDay().slice(0, 7) + "-01",
    },
  );

  const actorMaxOpCount = result[0]?.[0] as
    | Record<string, number>
    | null
    | undefined;
  const actorCap = actorMaxOpCount?.[resourceKey] ?? 0;

  if (actorCap <= 0) return "ok";

  const currentCount = result[1]?.[0]?.count ?? 0;
  return currentCount >= actorCap ? "limited" : "ok";
}

/**
 * Sends the one-shot per-resourceKey operation-count exhaustion alert email.
 */
async function sendOperationCountAlert(
  sub: {
    id: string;
    companyId: string;
    systemId: string;
  },
  params: { resourceKey: string; companyId: string; systemId: string },
  maxCount: number,
): Promise<void> {
  const db = await getDb();

  const alertResult = await db.query<
    [
      unknown[],
      { email: string; name: string; locale: string }[],
      { name: string; slug: string }[],
    ]
  >(
    `UPDATE $subId SET operationCountAlertSent = object::merge(CASE WHEN operationCountAlertSent IS NONE OR operationCountAlertSent = false THEN {} ELSE operationCountAlertSent END, $alertMerge);
     LET $companyId = $cId;
     LET $ownerId = (SELECT VALUE ownerId FROM company WHERE id = $companyId LIMIT 1)[0];
     SELECT email, profile.name AS name, profile.locale AS locale FROM user WHERE id = $ownerId LIMIT 1 FETCH profile;
     SELECT name, slug FROM system WHERE id = $systemId LIMIT 1;`,
    {
      subId: rid(sub.id),
      cId: rid(sub.companyId),
      systemId: rid(sub.systemId),
      alertMerge: { [params.resourceKey]: true },
    },
  );

  const user = alertResult[1]?.[0];
  const ownerEmail = user?.email;
  const ownerName = user?.name ?? "";
  const ownerLocale = user?.locale;
  const systemName = alertResult[2]?.[0]?.name ?? "";
  const systemSlug = alertResult[2]?.[0]?.slug ?? "";

  if (ownerEmail) {
    await publish("SEND_EMAIL", {
      recipients: [ownerEmail],
      template: "operation-count-alert",
      templateData: {
        name: ownerName,
        systemName,
        operationCount: String(maxCount),
        billingUrl: `/billing?system=${systemSlug}`,
      },
      locale: ownerLocale || undefined,
      systemSlug,
    });
  }
}

/**
 * Records a credit expense for reporting purposes only (no deduction).
 */
export async function trackCreditExpense(params: {
  resourceKey: string;
  amount: number;
  companyId: string;
  systemId: string;
  actorId?: string;
}): Promise<void> {
  const db = await getDb();
  const day = getCurrentDay();

  await db.query(
    `UPSERT credit_expense SET
      companyId = $companyId,
      systemId = $systemId,
      resourceKey = $resourceKey,
      amount += $amount,
      count += 1,
      day = $day,
      actorId = $actorId
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
      actorId: params.actorId ?? null,
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
}): Promise<
  { resourceKey: string; totalAmount: number; totalCount: number }[]
> {
  const db = await getDb();

  const result = await db.query<
    [{ resourceKey: string; totalAmount: number; totalCount: number }[]]
  >(
    `SELECT resourceKey, math::sum(amount) AS totalAmount, math::sum(count) AS totalCount
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
