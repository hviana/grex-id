import { publish } from "../event-queue/publisher.ts";
import { dispatchCommunication } from "../event-queue/handlers/send-communication.ts";
import type { Tenant } from "@/src/contracts/tenant.ts";
import type { TenantActorType } from "@/src/contracts/tenant.ts";
import { resolveMaxOperationCount } from "./guards.ts";
import { assertServerOnly } from "./server-only.ts";
import { rid } from "../db/connection.ts";
import {
  deductFromPlanCredits,
  deductFromPurchasedCredits,
  fetchActorOperationCap,
  fetchSubscriptionAndCreditBalance,
  queryCreditExpenses,
  setCreditAlertAndFetchOwner,
  setOperationCountAlertAndFetchOwner,
  upsertCreditExpense,
} from "../db/queries/credits.ts";

assertServerOnly("credit-tracker.ts");

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
 * Attempts to consume credits for an operation (§7.3).
 *
 * Deduction priority:
 * 1. Plan credits (subscription.remainingPlanCredits) — temporary, per-period
 * 2. Purchased credits (usage_record with resourceKey="credits") — persistent
 *
 * Operation-count cap (§7.3 step 2, per-resourceKey):
 * If remainingOperationCount[resourceKey] is 0 and the cap is active,
 * the operation is rejected regardless of available credits.
 * Actor-level cap (step 3) enforced for api_token actors.
 *
 * All DB lookups batched into single queries per logical step (§7.3).
 */
export async function consumeCredits(params: {
  resourceKey: string;
  amount: number;
  tenantId: string;
  tenant: Tenant;
  actorId?: string;
  actorType?: TenantActorType;
}): Promise<CreditDeductionResult> {
  const day = getCurrentDay();

  // Single batched query: fetch subscription + credit balance + conditionally set
  // auto-recharge re-entrancy guard (§7.3)
  const result = await fetchSubscriptionAndCreditBalance({
    tenantId: params.tenantId,
  });

  const sub = result[0]?.[0];
  if (!sub) {
    return { success: false, source: "insufficient" };
  }

  const planCredits = sub.remainingPlanCredits ?? 0;
  const purchasedCredits = result[1]?.[0]?.balance ?? 0;
  const totalAvailable = planCredits + purchasedCredits;

  // Per-resourceKey operation-count cap check (§7.3 step 2)
  const operationCounts: Record<string, number> =
    (sub.remainingOperationCount as Record<string, number>) ?? {};
  const remainingForThisKey = operationCounts[params.resourceKey] ?? 0;

  const opCap = await resolveMaxOperationCount({
    tenant: params.tenant,
    resourceKey: params.resourceKey,
  });

  if (opCap.max > 0 && remainingForThisKey === 0) {
    const rawAlertMap = sub.operationCountAlertSent;
    const alertMap: Record<string, boolean> =
      (typeof rawAlertMap === "object" && rawAlertMap !== null)
        ? rawAlertMap as Record<string, boolean>
        : {};
    if (!alertMap[params.resourceKey]) {
      await sendOperationCountAlert(
        sub,
        { resourceKey: params.resourceKey, tenantId: params.tenantId },
        opCap.max,
      );
    }
    return { success: false, source: "operationLimit" };
  }

  // Actor-level cap check (§7.3 step 3) for api_token actors
  if (
    params.actorId &&
    params.actorType === "api_token"
  ) {
    const actorCapResult = await checkActorOperationCap({
      actorId: params.actorId,
      actorType: params.actorType ?? "user",
      resourceKey: params.resourceKey,
      tenantId: params.tenantId,
    });

    if (actorCapResult === "limited") {
      return { success: false, source: "operationLimit" };
    }
  }

  // Insufficient credits
  if (totalAvailable < params.amount) {
    // Auto-recharge guard was set atomically in the batched query above
    if (sub.autoRechargeGuardSet) {
      await publish("auto_recharge", {
        subscriptionId: String(sub.id),
        tenantId: params.tenantId,
        resourceKey: params.resourceKey,
      });

      return { success: false, source: "insufficient" };
    }

    // No auto-recharge or already in progress — send alert (once per cycle)
    if (!sub.creditAlertSent) {
      const alertResult = await setCreditAlertAndFetchOwner({
        subId: String(sub.id),
        tenantId: params.tenantId,
      });

      const user = alertResult[2]?.[0];
      const ownerId = user?.id ? String(user.id) : "";
      const ownerName = user?.name ?? "";
      const ownerLocale = user?.locale;
      const systemName = alertResult[3]?.[0]?.name ?? "";
      const systemSlug = alertResult[3]?.[0]?.slug ?? "";

      if (ownerId) {
        await dispatchCommunication({
          recipients: [ownerId],
          template: "notification",
          templateData: {
            eventKey: "billing.event.insufficientCredit",
            occurredAt: new Date().toISOString(),
            actorName: ownerName,
            systemName,
            resources: [params.resourceKey],
            ctaKey: "templates.notification.cta.purchaseCredits",
            ctaUrl: `/billing?systemSlug=${systemSlug}`,
            locale: ownerLocale || undefined,
            systemSlug,
          },
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
    await deductFromPlanCredits({
      subId: String(sub.id),
      amount: params.amount,
      tenantId: params.tenantId,
      resourceKey: params.resourceKey,
      day,
      actorId: params.actorId ?? null,
      opCountMerge,
    });

    return {
      success: true,
      source: "plan",
      remainingPlanCredits: planCredits - params.amount,
      remainingPurchasedCredits: purchasedCredits,
    };
  }

  // Split: use all plan credits + remainder from purchased
  const fromPurchased = params.amount - planCredits;

  await deductFromPurchasedCredits({
    subId: String(sub.id),
    tenantId: params.tenantId,
    fromPurchased,
    totalAmount: params.amount,
    resourceKey: params.resourceKey,
    day,
    actorId: params.actorId ?? null,
    period: `${new Date().getFullYear()}-${
      String(new Date().getMonth() + 1).padStart(2, "0")
    }`,
    opCountMerge,
  });

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
  tenantId: string;
}): Promise<"ok" | "limited"> {
  const { actorId, actorType, resourceKey, tenantId } = params;

  const result = await fetchActorOperationCap({
    actorRid: rid(actorId),
    actorStr: actorId,
    resourceKey,
    tenantId: rid(tenantId),
    periodStart: getCurrentDay().slice(0, 7) + "-01",
  });

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
  },
  params: { resourceKey: string; tenantId: string },
  _maxCount: number,
): Promise<void> {
  const alertResult = await setOperationCountAlertAndFetchOwner({
    subId: String(sub.id),
    tenantId: params.tenantId,
    alertMerge: { [params.resourceKey]: true },
  });

  const user = alertResult[1]?.[0];
  const ownerId = user?.id ? String(user.id) : "";
  const ownerName = user?.name ?? "";
  const ownerLocale = user?.locale;
  const systemName = alertResult[2]?.[0]?.name ?? "";
  const systemSlug = alertResult[2]?.[0]?.slug ?? "";

  if (ownerId) {
    await dispatchCommunication({
      recipients: [ownerId],
      template: "notification",
      templateData: {
        eventKey: "billing.event.operationCountAlert",
        occurredAt: new Date().toISOString(),
        actorName: ownerName,
        systemName,
        resources: [params.resourceKey],
        ctaKey: "templates.notification.cta.viewBilling",
        ctaUrl: `/billing?systemSlug=${systemSlug}`,
        locale: ownerLocale || undefined,
        systemSlug,
      },
    });
  }
}

/**
 * Records a credit expense for reporting purposes only (no deduction).
 */
export async function trackCreditExpense(params: {
  resourceKey: string;
  amount: number;
  tenantId: string;
  actorId?: string;
}): Promise<void> {
  const day = getCurrentDay();

  await upsertCreditExpense({
    tenantId: params.tenantId,
    resourceKey: params.resourceKey,
    amount: params.amount,
    day,
    actorId: params.actorId ?? null,
  });
}

/**
 * Queries aggregated credit expenses for a tenant within a date range.
 */
export async function getCreditExpenses(params: {
  tenantId: string;
  startDate: string;
  endDate: string;
}): Promise<
  { resourceKey: string; totalAmount: number; totalCount: number }[]
> {
  return queryCreditExpenses(params);
}
