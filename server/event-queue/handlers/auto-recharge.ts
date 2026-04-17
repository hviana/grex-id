import { getDb, rid } from "../../db/connection.ts";
import { publish } from "../publisher.ts";
import Core from "../../utils/Core.ts";

if (typeof window !== "undefined") {
  throw new Error(
    "auto-recharge handler must not be imported in client-side code.",
  );
}

/**
 * Auto-recharge handler — triggered when credits are insufficient and
 * autoRechargeEnabled is true (§22.5).
 *
 * Steps:
 * 1. Verify subscription flags
 * 2. Load default payment method
 * 3. Notify user that auto-recharge is being attempted
 * 4. Create credit_purchase and publish PAYMENT_DUE
 *
 * All DB lookups batched into a single query (§7.2).
 */
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

  // Batch: subscription + default payment method + owner info + system name
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
      { email: string; name: string }[],
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
     SELECT email, profile.name AS name FROM user WHERE id = $ownerId LIMIT 1 FETCH profile;
     SELECT name, slug FROM system WHERE id = (SELECT VALUE systemId FROM subscription WHERE id = $subId LIMIT 1)[0] LIMIT 1;`,
    { subId: rid(payload.subscriptionId) },
  );

  const sub = result[0]?.[0];
  if (!sub || !sub.autoRechargeEnabled || !sub.autoRechargeInProgress) {
    return;
  }

  const paymentMethod = result[1]?.[0];
  const owner = result[2]?.[0];
  const systemInfo = result[3]?.[0];
  const systemName = systemInfo?.name ?? "";
  const systemSlug = systemInfo?.slug ?? "";

  // No payment method — notify failure, clear flag
  if (!paymentMethod) {
    if (owner?.email) {
      await publish("SEND_EMAIL", {
        recipients: [owner.email],
        template: "payment-failure",
        templateData: {
          name: owner.name ?? "",
          systemName,
          kind: "auto-recharge",
          amount: String(sub.autoRechargeAmount),
          currency: "cents",
          reason: "billing.autoRecharge.noPaymentMethod",
          billingUrl: `/billing?system=${systemSlug}`,
        },
        systemSlug,
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

  // Notify user that auto-recharge is being attempted
  if (owner?.email) {
    await publish("SEND_EMAIL", {
      recipients: [owner.email],
      template: "auto-recharge",
      templateData: {
        name: owner.name ?? "",
        systemName,
        amount: String(sub.autoRechargeAmount),
        currency: "cents",
        triggerResource: payload.resourceKey,
        billingUrl: `/billing?system=${systemSlug}`,
      },
      systemSlug,
    });
  }

  // Create credit purchase and publish PAYMENT_DUE
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

  await publish("PAYMENT_DUE", {
    creditPurchaseId: String(purchase[0]?.[0]?.id ?? ""),
    subscriptionId: String(sub.id),
    companyId: String(sub.companyId),
    systemId: String(sub.systemId),
    amount: String(sub.autoRechargeAmount),
    purpose: "auto-recharge",
  });
}
