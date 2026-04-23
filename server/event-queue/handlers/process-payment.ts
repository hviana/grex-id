import type { HandlerFn } from "../worker.ts";
import { publish } from "../publisher.ts";
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

  // Idempotency: if recurring already processed, skip (§14.5)
  if (
    isRecurring && sub.status === "active" &&
    new Date(sub.currentPeriodEnd) > new Date()
  ) {
    console.log(
      `[payment] Subscription ${subscriptionId} already renewed, skipping.`,
    );
    return;
  }

  // Idempotency: if credit purchase already processed, skip (§14.5)
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

  // Create payment record (§22.8) — only if payment method exists
  let paymentId: string | undefined;
  if (sub.paymentMethodId) {
    paymentId = await createPaymentRecord({
      companyId: String(sub.companyId),
      systemId: String(sub.systemId),
      subscriptionId: sub.id,
      amount: chargeAmount,
      currency,
      kind,
      paymentMethodId: sub.paymentMethodId,
    });
  }

  // TODO: Call actual payment provider with chargeAmount (Phase 6)
  // const providerResult = await provider.charge(chargeAmount, { ... });
  // For now, stub returns synchronous success:
  const providerResult: PaymentResult = {
    success: true,
  };
  const success = providerResult.success;
  const failureReason = providerResult.error ?? "";
  const invoiceUrl = providerResult.invoiceUrl ?? "";

  const billingUrl = `/billing?system=${systemSlug}`;
  const ownerName = owner?.name ?? "";
  const ownerId = owner?.id ? String(owner.id) : "";

  // Async payment detection (§22.9)
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

    // Send payment-pending notification (§22.9)
    if (ownerId) {
      await publish("send_communication", {
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

    // Do NOT activate subscription, credits, or credit purchase.
    // The webhook handler will resolve the payment later (§22.9).
    return;
  }

  if (success) {
    if (isRecurring) {
      // Recurring billing success — advance period, reset credits (§16)
      const newStart = new Date(sub.currentPeriodEnd);
      const newEnd = new Date(
        newStart.getTime() + plan.recurrenceDays * 86400000,
      );
      const creditModifier = voucher?.creditModifier ?? 0;
      const remainingPlanCredits = (plan.planCredits ?? 0) + creditModifier;

      const remainingOperationCount = await resolveAllOperationCounts({
        companyId: String(sub.companyId),
        systemId: String(sub.systemId),
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

      await Core.getInstance().reloadSubscription(
        String(sub.companyId),
        String(sub.systemId),
      );
    } else {
      // Credit purchase or auto-recharge — increment purchased credits (§22.3)
      const period = new Date().toISOString().slice(0, 7);

      await creditPurchaseOnSuccess({
        companyId: String(sub.companyId),
        systemId: String(sub.systemId),
        amount: chargeAmount,
        period,
        subscriptionId: sub.id,
        creditPurchaseId,
        isAutoRecharge: purpose === "auto-recharge",
        paymentId,
        invoiceUrl: invoiceUrl || undefined,
      });

      await Core.getInstance().reloadSubscription(
        String(sub.companyId),
        String(sub.systemId),
      );
    }

    // Notification on success (§16)
    if (ownerId) {
      await publish("send_communication", {
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
    // Payment failed
    await paymentOnFailure({
      subscriptionId: sub.id,
      isRecurring,
      isRetry,
      isAutoRecharge: purpose === "auto-recharge",
      creditPurchaseId,
      paymentId,
      failureReason: failureReason || "billing.payment.genericFailure",
    });

    await Core.getInstance().reloadSubscription(
      String(sub.companyId),
      String(sub.systemId),
    );

    if (ownerId) {
      await publish("send_communication", {
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
