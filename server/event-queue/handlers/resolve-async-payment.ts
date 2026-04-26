import type { HandlerFn } from "../worker.ts";
import { dispatchCommunication } from "./send-communication.ts";
import Core from "../../utils/Core.ts";
import { resolveAllOperationCounts } from "../../utils/guards.ts";
import { assertServerOnly } from "../../utils/server-only.ts";
import {
  getAsyncPaymentContext,
  resolveAsyncCreditSuccess,
  resolveAsyncPaymentFailure,
  resolveAsyncRecurringSuccess,
} from "../../db/queries/billing.ts";

assertServerOnly("resolve-async-payment handler");

export const resolveAsyncPayment: HandlerFn = async (payload) => {
  const paymentId = payload.paymentId as string;
  const success = payload.success as boolean;
  const transactionId = payload.transactionId as string | undefined;
  const invoiceUrl = payload.invoiceUrl as string | undefined;
  const failureReason = payload.failureReason as string | undefined;

  const ctx = await getAsyncPaymentContext(paymentId);

  const payment = ctx.payment;
  if (!payment) {
    console.log(
      `[resolve-async] Payment ${paymentId} not found, skipping.`,
    );
    return;
  }

  if (
    payment.status === "completed" ||
    payment.status === "failed" ||
    payment.status === "expired"
  ) {
    console.log(
      `[resolve-async] Payment ${paymentId} already ${payment.status}, skipping.`,
    );
    return;
  }

  const sub = ctx.sub;
  const plan = ctx.plan;
  const voucher = ctx.voucher;
  const owner = ctx.owner;
  const systemInfo = ctx.systemInfo;
  const creditPurchase = ctx.creditPurchase;
  const systemName = systemInfo?.name ?? "";
  const systemSlug = systemInfo?.slug ?? "";
  const currency = plan?.currency ?? payment.currency ?? "USD";
  const kind = payment.kind;
  const chargeAmount = payment.amount;
  const isRecurring = kind === "recurring";
  const effectiveTenantId = String(
    Array.isArray(payment.tenantIds) ? payment.tenantIds[0] : payment.tenantIds,
  );

  const billingUrl = `/billing?systemSlug=${systemSlug}`;
  const ownerName = owner?.name ?? "";
  const ownerId = owner?.id ? String(owner.id) : "";

  if (success) {
    if (isRecurring && sub) {
      const newStart = new Date(sub.currentPeriodEnd);
      const newEnd = new Date(
        newStart.getTime() + (plan?.recurrenceDays ?? 30) * 86400000,
      );
      const creditModifier = voucher?.creditModifier ?? 0;
      const remainingPlanCredits = (plan?.planCredits ?? 0) + creditModifier;

      const remainingOperationCount = await resolveAllOperationCounts({
        tenant: {
          id: effectiveTenantId,
        } as import("../../../src/contracts/tenant.ts").Tenant,
      });

      await resolveAsyncRecurringSuccess({
        subscriptionId: sub.id,
        paymentId,
        newStart,
        newEnd,
        remainingPlanCredits,
        remainingOperationCount,
        hasPendingCreditPurchase: !!creditPurchase,
        transactionId,
        invoiceUrl,
      });
    } else {
      const period = new Date().toISOString().slice(0, 7);

      await resolveAsyncCreditSuccess({
        tenantId: effectiveTenantId,
        amount: chargeAmount,
        period,
        subscriptionId: sub?.id,
        paymentId,
        hasPendingCreditPurchase: !!(creditPurchase && sub),
        isAutoRecharge: kind === "auto-recharge",
        transactionId,
        invoiceUrl,
      });
    }

    await Core.getInstance().reloadSubscription(effectiveTenantId);

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
    await resolveAsyncPaymentFailure({
      subscriptionId: sub?.id,
      paymentId,
      isRecurring,
      isAutoRecharge: kind === "auto-recharge",
      hasPendingCreditPurchase: !!creditPurchase,
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
