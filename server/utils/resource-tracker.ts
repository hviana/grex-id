import "server-only";

import { publish } from "../event-queue/publisher.ts";
import { dispatchCommunication } from "../event-queue/handlers/send-communication.ts";
import type { Tenant } from "@/src/contracts/tenant";
import {
  queryCreditExpenses,
  setCreditAlertAndFetchOwner,
  setOperationCountAlertAndFetchOwner,
} from "../db/queries/credits.ts";

import type { CreditDeductionResult } from "@/src/contracts/high-level/verification";
export type { CreditDeductionResult };

/**
 * consumeCredits — Consumes credits for an operation (§7.3).
 *
 * Delegates to queryCreditExpenses for the unified deduction logic,
 * then handles alert/notification dispatch based on the result.
 *
 * Pseudocode:
 * 1. Call queryCreditExpenses(tenant, resourceKey, amount)
 *    - This handles all deduction, expense tracking, and limit checks
 * 2. If operationLimit and alert not yet sent:
 *    - Call setOperationCountAlertAndFetchOwner to set the flag
 *    - Dispatch notification to company owner
 * 3. If insufficient and auto-recharge triggered:
 *    - Publish auto_recharge event for the handler
 * 4. If insufficient and credit alert not yet sent:
 *    - Call setCreditAlertAndFetchOwner to set the flag
 *    - Dispatch notification to company owner
 * 5. Return result
 */
export async function consumeCredits(params: {
  resourceKey: string;
  amount: number;
  tenant: Tenant;
}): Promise<CreditDeductionResult> {
  const result = await queryCreditExpenses({
    tenant: params.tenant,
    resourceKey: params.resourceKey,
    amount: params.amount,
  });

  // Handle operation limit alert
  if (!result.success && result.source === "operationLimit") {
    const alertResult = await setOperationCountAlertAndFetchOwner({
      tenant: params.tenant,
      resourceKey: params.resourceKey,
    });

    if (alertResult.alerted && alertResult.ownerId) {
      const actorLabel = result.actorName ? ` (${result.actorName})` : "";
      await dispatchCommunication({
        recipients: [alertResult.ownerId],
        template: "notification",
        templateData: {
          eventKey: "billing.event.operationCountAlert",
          occurredAt: new Date().toISOString(),
          actorName: alertResult.ownerName,
          systemName: alertResult.systemName,
          resources: [params.resourceKey + actorLabel],
          ctaKey: "templates.notification.cta.viewBilling",
          ctaUrl: `/billing?systemSlug=${alertResult.systemSlug}`,
          locale: alertResult.ownerLocale || undefined,
          systemSlug: alertResult.systemSlug,
        },
      });
    }
  }

  // Handle insufficient credits — auto-recharge
  if (
    !result.success && result.source === "insufficient" &&
    result.autoRechargeTriggered && result.subscriptionId
  ) {
    await publish("auto_recharge", {
      subscriptionId: result.subscriptionId,
      tenantId: params.tenant.id!,
      resourceKey: params.resourceKey,
    });
  }

  // Handle insufficient credits — alert
  if (
    !result.success && result.source === "insufficient" &&
    !result.autoRechargeTriggered
  ) {
    const alertResult = await setCreditAlertAndFetchOwner({
      tenant: params.tenant,
    });

    if (alertResult.alerted && alertResult.ownerId) {
      await dispatchCommunication({
        recipients: [alertResult.ownerId],
        template: "notification",
        templateData: {
          eventKey: "billing.event.insufficientCredit",
          occurredAt: new Date().toISOString(),
          actorName: alertResult.ownerName,
          systemName: alertResult.systemName,
          resources: [params.resourceKey],
          ctaKey: "templates.notification.cta.purchaseCredits",
          ctaUrl: `/billing?systemSlug=${alertResult.systemSlug}`,
          locale: alertResult.ownerLocale || undefined,
          systemSlug: alertResult.systemSlug,
        },
      });
    }
  }

  return {
    success: result.success,
    source: result.source,
    remainingPlanCredits: result.remainingPlanCredits,
    remainingPurchasedCredits: result.remainingPurchasedCredits,
  };
}
