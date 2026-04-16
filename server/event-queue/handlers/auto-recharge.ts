import { getDb, rid } from "../../db/connection.ts";
import { publish } from "../publisher.ts";

if (typeof window !== "undefined") {
  throw new Error("auto-recharge handler must not be imported in client-side code.");
}

/**
 * Auto-recharge handler — triggered when credits are insufficient and
 * autoRechargeEnabled is true.
 *
 * Steps:
 * 1. Verify subscription flags
 * 2. Load default payment method
 * 3. Notify user that auto-recharge is being attempted
 * 4. Create credit_purchase and publish PAYMENT_DUE
 * 5. Clear autoRechargeInProgress on completion
 */
export async function handleAutoRecharge(payload: {
  subscriptionId: string;
  companyId: string;
  systemId: string;
  resourceKey: string;
}): Promise<void> {
  const db = await getDb();

  // Load subscription
  const subResult = await db.query<
    [{
      id: string;
      autoRechargeEnabled: boolean;
      autoRechargeAmount: number;
      autoRechargeInProgress: boolean;
      companyId: string;
      systemId: string;
    }[]]
  >(
    `SELECT id, autoRechargeEnabled, autoRechargeAmount, autoRechargeInProgress,
            companyId, systemId
     FROM subscription WHERE id = $subId LIMIT 1`,
    { subId: rid(payload.subscriptionId) },
  );

  const sub = subResult[0]?.[0];
  if (!sub || !sub.autoRechargeEnabled || !sub.autoRechargeInProgress) {
    // Nothing to do — mark as done
    return;
  }

  // Load default payment method
  const pmResult = await db.query<[{ id: string }[]]>(
    `SELECT id FROM payment_method
     WHERE companyId = $companyId AND isDefault = true LIMIT 1`,
    { companyId: rid(String(sub.companyId)) },
  );

  if (!pmResult[0] || pmResult[0].length === 0) {
    // No payment method — notify failure
    const ownerInfo = await db.query<
      [{ email: string; profile: { name: string } }[]]
    >(
      `LET $comp = (SELECT ownerId FROM company WHERE id = $companyId LIMIT 1);
       SELECT email, profile.name AS name FROM user WHERE id = $comp[0].ownerId LIMIT 1 FETCH profile;`,
      { companyId: rid(String(sub.companyId)) },
    );
    const owner = ownerInfo[0]?.[0];
    const sysResult = await db.query<[{ name: string; slug: string }[]]>(
      `SELECT name, slug FROM system WHERE id = $systemId LIMIT 1`,
      { systemId: rid(String(sub.systemId)) },
    );
    const systemName = sysResult[0]?.[0]?.name ?? "";
    const systemSlug = sysResult[0]?.[0]?.slug ?? "";

    if (owner?.email) {
      await publish("SEND_EMAIL", {
        recipients: [owner.email],
        template: "payment-failure",
        templateData: {
          name: owner.profile?.name ?? "",
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

    // Clear flag
    await db.query(
      `UPDATE $subId SET autoRechargeInProgress = false`,
      { subId: rid(sub.id) },
    );
    return;
  }

  // Notify user that auto-recharge is being attempted
  const ownerInfo = await db.query<
    [{ email: string; profile: { name: string } }[]]
  >(
    `LET $comp = (SELECT ownerId FROM company WHERE id = $companyId LIMIT 1);
     SELECT email, profile.name AS name FROM user WHERE id = $comp[0].ownerId LIMIT 1 FETCH profile;`,
    { companyId: rid(String(sub.companyId)) },
  );
  const owner = ownerInfo[0]?.[0];
  const sysResult = await db.query<[{ name: string; slug: string }[]]>(
    `SELECT name, slug FROM system WHERE id = $systemId LIMIT 1`,
    { systemId: rid(String(sub.systemId)) },
  );
  const systemName = sysResult[0]?.[0]?.name ?? "";
  const systemSlug = sysResult[0]?.[0]?.slug ?? "";

  if (owner?.email) {
    await publish("SEND_EMAIL", {
      recipients: [owner.email],
      template: "auto-recharge",
      templateData: {
        name: owner.profile?.name ?? "",
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
  const purchase = await db.query<[ { id: string }[] ]>(
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
      paymentMethodId: rid(String(pmResult[0][0].id)),
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

  // Note: autoRechargeInProgress will be cleared by the payment success/failure handler
  // or by the billing page after confirming the charge result.
}
