import type { HandlerFn } from "@/src/contracts/high_level/event-queue";
import { dispatchCommunication } from "./send-communication.ts";
import Core from "../../utils/Core.ts";
import { resolveAllOperationCounts } from "../../utils/guards.ts";
import type { PaymentResult } from "../../../src/contracts/payment-provider.ts";
import { assertServerOnly } from "../../utils/server-only.ts";
import {
  createPaymentRecord,
  creditPurchaseOnSuccess,
  getPaymentSubscriptionContext,
  paymentOnFailure,
  renewSubscriptionOnSuccess,
  updatePaymentAsyncData,
} from "../../db/queries/billing.ts";

assertServerOnly("process-payment handler");

export const processPayment: HandlerFn = async (payload) => {
  const subscriptionId = payload.subscriptionId as string;
  const explicitAmount = payload.amount as string | undefined;
  const purpose = payload.purpose as string | undefined;
  const creditPurchaseId = payload.creditPurchaseId as string | undefined;
  const tenantId = payload.tenantId as string | undefined;
  const isRecurring = !explicitAmount;
  const isRetry = purpose === "retry";

  const ctx = await getPaymentSubscriptionContext({
    subscriptionId,
    creditPurchaseId,
  });

  const sub = ctx.sub;
  if (!sub) {
    console.log(
      `[payment] Subscription ${subscriptionId} not found, skipping.`,
    );
    return;
  }

  const effectiveTenantId = tenantId ??
    String(Array.isArray(sub.tenantIds) ? sub.tenantIds[0] : sub.tenantIds);

  if (
    isRecurring && sub.status === "active" &&
    new Date(sub.currentPeriodEnd) > new Date()
  ) {
    console.log(
      `[payment] Subscription ${subscriptionId} already renewed, skipping.`,
    );
    return;
  }

  if (
    creditPurchaseId && ctx.purchaseStatus && ctx.purchaseStatus !== "pending"
  ) {
    console.log(
      `[payment] Credit purchase ${creditPurchaseId} already processed (${ctx.purchaseStatus}), skipping.`,
    );
    return;
  }

  const plan = ctx.plan;
  if (!plan) return;

  const voucher = ctx.voucher;
  const owner = ctx.owner;
  const systemInfo = ctx.systemInfo;
  const systemName = systemInfo?.name ?? "";
  const systemSlug = systemInfo?.slug ?? "";
  const currency = plan.currency ?? "USD";

  const chargeAmount = explicitAmount
    ? Number(explicitAmount)
    : Math.max(0, plan.price + (voucher?.priceModifier ?? 0));

  const kind = isRetry
    ? "recurring"
    : purpose === "auto-recharge"
    ? "auto-recharge"
    : !isRecurring
    ? "credits"
    : "recurring";

  let paymentId: string | undefined;
  if (sub.paymentMethodId) {
    paymentId = await createPaymentRecord({
      tenantId: effectiveTenantId,
      subscriptionId: sub.id,
      amount: chargeAmount,
      currency,
      kind,
      paymentMethodId: sub.paymentMethodId,
    });
  }

  const providerResult: PaymentResult = {
    success: true,
  };
  const success = providerResult.success;
  const failureReason = providerResult.error ?? "";
  const invoiceUrl = providerResult.invoiceUrl ?? "";

  const billingUrl = `/billing?systemSlug=${systemSlug}`;
  const ownerName = owner?.name ?? "";
  const ownerId = owner?.id ? String(owner.id) : "";

  const isAsync = providerResult.expiresInSeconds != null &&
    providerResult.continuityData != null;

  if (isAsync) {
    const expiresAt = new Date(
      Date.now() + providerResult.expiresInSeconds! * 1000,
    );

    if (paymentId) {
      await updatePaymentAsyncData({
        paymentId,
        continuityData: providerResult.continuityData!,
        expiresAt,
      });
    }

    if (ownerId) {
      await dispatchCommunication({
        recipients: [ownerId],
        template: "notification",
        templateData: {
          eventKey: `billing.event.paymentPending.${kind}`,
          occurredAt: new Date().toISOString(),
          actorName: ownerName,
          systemName,
          value: { amount: chargeAmount, currency },
          ctaKey: "templates.notification.cta.viewBilling",
          ctaUrl: billingUrl,
          resources: [
            `billing.paymentKind.${kind}`,
          ],
          systemSlug,
          expiresInSeconds: String(providerResult.expiresInSeconds),
          continuityData: providerResult.continuityData,
        },
      });
    }

    return;
  }

  if (success) {
    if (isRecurring) {
      const newStart = new Date(sub.currentPeriodEnd);
      const newEnd = new Date(
        newStart.getTime() + plan.recurrenceDays * 86400000,
      );
      const creditModifier =
        (voucher?.resourceLimitId as Record<string, unknown>)
          ?.credits as number ?? 0;
      const remainingPlanCredits =
        ((plan.resourceLimitId as Record<string, unknown>)?.credits as number ??
          0) + creditModifier;

      const remainingOperationCount = await resolveAllOperationCounts({
        systemId: ctx.systemId,
        companyId: ctx.companyId,
      });

      await renewSubscriptionOnSuccess({
        subscriptionId: sub.id,
        isRetry,
        newStart,
        newEnd,
        remainingPlanCredits,
        remainingOperationCount,
        paymentId,
        invoiceUrl: invoiceUrl || undefined,
      });

      await Core.getInstance().reloadSubscription(effectiveTenantId);
    } else {
      const period = new Date().toISOString().slice(0, 7);

      await creditPurchaseOnSuccess({
        tenantId: effectiveTenantId,
        amount: chargeAmount,
        period,
        subscriptionId: sub.id,
        creditPurchaseId,
        isAutoRecharge: purpose === "auto-recharge",
        paymentId,
        invoiceUrl: invoiceUrl || undefined,
      });

      await Core.getInstance().reloadSubscription(effectiveTenantId);
    }

    if (ownerId) {
      await dispatchCommunication({
        recipients: [ownerId],
        template: "notification",
        templateData: {
          eventKey: `billing.event.paymentSuccess.${kind}`,
          occurredAt: new Date().toISOString(),
          actorName: ownerName,
          systemName,
          value: { amount: chargeAmount, currency },
          invoiceUrl,
          ctaKey: "templates.notification.cta.viewBilling",
          ctaUrl: billingUrl,
          resources: [`billing.paymentKind.${kind}`],
          systemSlug,
        },
      });
    }
  } else {
    await paymentOnFailure({
      subscriptionId: sub.id,
      isRecurring,
      isRetry,
      isAutoRecharge: purpose === "auto-recharge",
      creditPurchaseId,
      paymentId,
      failureReason: failureReason || "billing.payment.genericFailure",
    });

    await Core.getInstance().reloadSubscription(effectiveTenantId);

    if (ownerId) {
      await dispatchCommunication({
        recipients: [ownerId],
        template: "notification",
        templateData: {
          eventKey: `billing.event.paymentFailure.${kind}`,
          occurredAt: new Date().toISOString(),
          actorName: ownerName,
          systemName,
          value: { amount: chargeAmount, currency },
          ctaKey: "templates.notification.cta.updatePaymentMethod",
          ctaUrl: billingUrl,
          resources: [
            `billing.paymentKind.${kind}`,
            failureReason || "billing.payment.genericFailure",
          ],
          systemSlug,
        },
      });
    }
  }
};
