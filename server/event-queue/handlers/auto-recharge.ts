import { publish } from "../publisher.ts";
import { dispatchCommunication } from "./send-communication.ts";
import Core from "../../utils/Core.ts";
import { assertServerOnly } from "../../utils/server-only.ts";
import {
  clearAutoRechargeFlag,
  createAutoRechargePurchase,
  getAutoRechargeContext,
} from "../../db/queries/billing.ts";

assertServerOnly("auto-recharge handler");

export async function handleAutoRecharge(
  rawPayload: Record<string, unknown>,
): Promise<void> {
  const payload = rawPayload as {
    subscriptionId: string;
    tenantId: string;
    resourceKey: string;
  };

  const ctx = await getAutoRechargeContext(payload.subscriptionId);

  const sub = ctx.sub;
  if (!sub || !sub.autoRechargeEnabled || !sub.autoRechargeInProgress) {
    return;
  }

  const paymentMethod = ctx.paymentMethod;
  const owner = ctx.owner;
  const ownerId = owner?.id ? String(owner.id) : "";
  const systemInfo = ctx.systemInfo;
  const systemName = systemInfo?.name ?? "";
  const systemSlug = systemInfo?.slug ?? "";
  const billingUrl = `/billing?systemSlug=${systemSlug}`;
  const amountValue = {
    amount: sub.autoRechargeAmount,
    currency: "USD",
  };

  if (!paymentMethod) {
    if (ownerId) {
      await dispatchCommunication({
        recipients: [ownerId],
        template: "notification",
        templateData: {
          eventKey: "billing.event.paymentFailure.auto-recharge",
          occurredAt: new Date().toISOString(),
          actorName: owner?.name ?? "",
          systemName,
          value: amountValue,
          resources: [
            "billing.paymentKind.auto-recharge",
            "billing.autoRecharge.noPaymentMethod",
          ],
          ctaKey: "templates.notification.cta.updatePaymentMethod",
          ctaUrl: billingUrl,
          systemSlug,
        },
      });
    }

    await clearAutoRechargeFlag(sub.id);

    await Core.getInstance().reloadSubscription(
      String(
        sub.tenantIds instanceof Set
          ? [...sub.tenantIds][0]
          : Array.isArray(sub.tenantIds)
          ? sub.tenantIds[0]
          : sub.tenantIds,
      ),
    );
    return;
  }

  if (ownerId) {
    await dispatchCommunication({
      recipients: [ownerId],
      template: "notification",
      templateData: {
        eventKey: "billing.event.autoRechargeStarted",
        occurredAt: new Date().toISOString(),
        actorName: owner?.name ?? "",
        systemName,
        value: amountValue,
        resources: [payload.resourceKey],
        ctaKey: "templates.notification.cta.viewBilling",
        ctaUrl: billingUrl,
        systemSlug,
      },
    });
  }

  const purchaseId = await createAutoRechargePurchase({
    tenantId: String(
      sub.tenantIds instanceof Set
        ? [...sub.tenantIds][0]
        : Array.isArray(sub.tenantIds)
        ? sub.tenantIds[0]
        : sub.tenantIds,
    ),
    amount: sub.autoRechargeAmount,
    paymentMethodId: String(paymentMethod.id),
    subscriptionId: String(sub.id),
  });

  await publish("process_payment", {
    creditPurchaseId: purchaseId,
    subscriptionId: String(sub.id),
    tenantId: String(
      sub.tenantIds instanceof Set
        ? [...sub.tenantIds][0]
        : Array.isArray(sub.tenantIds)
        ? sub.tenantIds[0]
        : sub.tenantIds,
    ),
    amount: String(sub.autoRechargeAmount),
    purpose: "auto-recharge",
  });
}
