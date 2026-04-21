import { getDb, rid } from "../../db/connection.ts";
import { publish } from "../publisher.ts";
import Core from "../../utils/Core.ts";

if (typeof window !== "undefined") {
  throw new Error(
    "auto-recharge handler must not be imported in client-side code.",
  );
}

export async function handleAutoRecharge(
  rawPayload: Record<string, unknown>,
): Promise<void> {
  const payload = rawPayload as {
    subscriptionId: string;
    companyId: string;
    systemId: string;
    resourceKey: string;
  };
  const db = await getDb();

  const result = await db.query<
    [
      {
        id: string;
        autoRechargeEnabled: boolean;
        autoRechargeAmount: number;
        autoRechargeInProgress: boolean;
        companyId: string;
        systemId: string;
      }[],
      { id: string }[],
      { id: string; name: string }[],
      { name: string; slug: string }[],
    ]
  >(
    `SELECT id, autoRechargeEnabled, autoRechargeAmount, autoRechargeInProgress,
            companyId, systemId
     FROM subscription WHERE id = $subId LIMIT 1;
     SELECT id FROM payment_method
       WHERE companyId = (SELECT VALUE companyId FROM subscription WHERE id = $subId LIMIT 1)[0]
       AND isDefault = true LIMIT 1;
     LET $ownerId = (SELECT VALUE ownerId FROM company WHERE id = (SELECT VALUE companyId FROM subscription WHERE id = $subId LIMIT 1)[0] LIMIT 1)[0];
     SELECT id, profile.name AS name FROM user WHERE id = $ownerId LIMIT 1 FETCH profile;
     SELECT name, slug FROM system WHERE id = (SELECT VALUE systemId FROM subscription WHERE id = $subId LIMIT 1)[0] LIMIT 1;`,
    { subId: rid(payload.subscriptionId) },
  );

  const sub = result[0]?.[0];
  if (!sub || !sub.autoRechargeEnabled || !sub.autoRechargeInProgress) {
    return;
  }

  const paymentMethod = result[1]?.[0];
  const owner = result[2]?.[0];
  const ownerId = owner?.id ? String(owner.id) : "";
  const systemInfo = result[3]?.[0];
  const systemName = systemInfo?.name ?? "";
  const systemSlug = systemInfo?.slug ?? "";
  const billingUrl = `/billing?system=${systemSlug}`;
  const amountValue = {
    amount: sub.autoRechargeAmount,
    currency: "USD",
  };

  if (!paymentMethod) {
    if (ownerId) {
      await publish("send_communication", {
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

    await db.query(
      `UPDATE $subId SET autoRechargeInProgress = false`,
      { subId: rid(sub.id) },
    );

    await Core.getInstance().reloadSubscription(
      String(sub.companyId),
      String(sub.systemId),
    );
    return;
  }

  if (ownerId) {
    await publish("send_communication", {
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

  const purchase = await db.query<[{ id: string }[]]>(
    `CREATE credit_purchase SET
       companyId = $companyId,
       systemId = $systemId,
       amount = $amount,
       paymentMethodId = $paymentMethodId,
       status = "pending"`,
    {
      companyId: rid(String(sub.companyId)),
      systemId: rid(String(sub.systemId)),
      amount: sub.autoRechargeAmount,
      paymentMethodId: rid(String(paymentMethod.id)),
    },
  );

  await publish("process_payment", {
    creditPurchaseId: String(purchase[0]?.[0]?.id ?? ""),
    subscriptionId: String(sub.id),
    companyId: String(sub.companyId),
    systemId: String(sub.systemId),
    amount: String(sub.autoRechargeAmount),
    purpose: "auto-recharge",
  });
}
