import type { HandlerFn } from "../worker.ts";
import { getDb, rid } from "../../db/connection.ts";
import { publish } from "../publisher.ts";
import Core from "../../utils/Core.ts";

if (typeof window !== "undefined") {
  throw new Error(
    "process-payment handler must not be imported in client-side code.",
  );
}

export const processPayment: HandlerFn = async (payload) => {
  const subscriptionId = payload.subscriptionId as string;
  const explicitAmount = payload.amount as string | undefined;
  const purpose = payload.purpose as string | undefined;
  const creditPurchaseId = payload.creditPurchaseId as string | undefined;
  const isRecurring = !explicitAmount;
  const db = await getDb();

  // Batch: subscription + plan + voucher + owner info + system info (§7.2)
  const result = await db.query<
    [
      {
        id: string;
        planId: string;
        paymentMethodId: string;
        companyId: string;
        systemId: string;
        currentPeriodEnd: string;
        voucherId: string | null;
      }[],
      {
        price: number;
        recurrenceDays: number;
        planCredits: number;
        currency: string;
      }[],
      { priceModifier: number; creditIncrement: number }[],
      { email: string; name: string }[],
      { name: string; slug: string }[],
    ]
  >(
    `SELECT * FROM subscription WHERE id = $id LIMIT 1;
     LET $planId = (SELECT VALUE planId FROM subscription WHERE id = $id LIMIT 1)[0];
     SELECT price, recurrenceDays, planCredits, currency FROM plan WHERE id = $planId LIMIT 1;
     LET $voucherId = (SELECT VALUE voucherId FROM subscription WHERE id = $id LIMIT 1)[0];
     IF $voucherId != NONE {
       SELECT priceModifier, creditIncrement FROM voucher WHERE id = $voucherId LIMIT 1;
     } ELSE {
       SELECT NONE FROM NONE;
     };
     LET $companyId = (SELECT VALUE companyId FROM subscription WHERE id = $id LIMIT 1)[0];
     LET $ownerId = (SELECT VALUE ownerId FROM company WHERE id = $companyId LIMIT 1)[0];
     SELECT email, profile.name AS name FROM user WHERE id = $ownerId LIMIT 1 FETCH profile;
     LET $systemId = (SELECT VALUE systemId FROM subscription WHERE id = $id LIMIT 1)[0];
     SELECT name, slug FROM system WHERE id = $systemId LIMIT 1;`,
    { id: rid(subscriptionId) },
  );

  const sub = result[0]?.[0];
  if (!sub) {
    console.log(
      `[payment] Subscription ${subscriptionId} not found, skipping.`,
    );
    return;
  }

  const plan = result[1]?.[0];
  if (!plan) return;

  const voucher = result[2]?.[0];
  const owner = result[3]?.[0];
  const systemInfo = result[4]?.[0];
  const systemName = systemInfo?.name ?? "";
  const systemSlug = systemInfo?.slug ?? "";
  const currency = plan.currency ?? "USD";

  const chargeAmount = explicitAmount
    ? Number(explicitAmount)
    : Math.max(0, plan.price + (voucher?.priceModifier ?? 0));

  // TODO: Call actual payment provider with chargeAmount (Phase 6)
  // For now, simulate success
  const success = true;
  const failureReason = "";

  const kind = purpose === "auto-recharge"
    ? "auto-recharge"
    : !isRecurring
    ? "credits"
    : "recurring";

  const billingUrl = `/billing?system=${systemSlug}`;
  const ownerName = owner?.name ?? "";
  const ownerEmail = owner?.email ?? "";

  if (success) {
    if (isRecurring) {
      // Recurring billing success — advance period, reset credits (§16)
      const newStart = new Date(sub.currentPeriodEnd);
      const newEnd = new Date(
        newStart.getTime() + plan.recurrenceDays * 86400000,
      );
      const creditIncrement = voucher?.creditIncrement ?? 0;
      const remainingPlanCredits = (plan.planCredits ?? 0) + creditIncrement;

      await db.query(
        `UPDATE $id SET
          currentPeriodStart = $newStart,
          currentPeriodEnd = $newEnd,
          remainingPlanCredits = $remainingPlanCredits,
          creditAlertSent = false`,
        {
          id: rid(sub.id),
          newStart,
          newEnd,
          remainingPlanCredits,
        },
      );

      await Core.getInstance().reloadSubscription(
        String(sub.companyId),
        String(sub.systemId),
      );
    } else {
      // Credit purchase or auto-recharge — increment purchased credits (§22.3)
      const period = new Date().toISOString().slice(0, 7);
      const stmts = [
        `UPSERT usage_record SET
          actorType = "user", actorId = "0",
          companyId = $companyId, systemId = $systemId,
          resource = "credits", value += $amount, period = $period
         WHERE companyId = $companyId AND systemId = $systemId
           AND resource = "credits";`,
      ];
      const params: Record<string, unknown> = {
        companyId: rid(String(sub.companyId)),
        systemId: rid(String(sub.systemId)),
        amount: chargeAmount,
        period,
        subId: rid(sub.id),
      };

      if (creditPurchaseId) {
        stmts.push(`UPDATE $purchaseId SET status = "done";`);
        params.purchaseId = rid(creditPurchaseId);
      }
      if (purpose === "auto-recharge") {
        stmts.push(`UPDATE $subId SET autoRechargeInProgress = false;`);
      }

      await db.query(stmts.join("\n"), params);

      await Core.getInstance().reloadSubscription(
        String(sub.companyId),
        String(sub.systemId),
      );
    }

    // Email on success (§16)
    if (ownerEmail) {
      await publish("SEND_EMAIL", {
        recipients: [ownerEmail],
        template: "payment-success",
        templateData: {
          name: ownerName,
          systemName,
          kind,
          amount: String(chargeAmount),
          currency,
          billingUrl,
        },
        systemSlug,
      });
    }
  } else {
    // Payment failed — single batched query (§7.2)
    const stmts: string[] = [];
    const params: Record<string, unknown> = { subId: rid(sub.id) };

    if (isRecurring) {
      stmts.push(`UPDATE $subId SET status = "past_due";`);
    }
    if (purpose === "auto-recharge") {
      stmts.push(`UPDATE $subId SET autoRechargeInProgress = false;`);
    }
    if (creditPurchaseId) {
      stmts.push(`UPDATE $purchaseId SET status = "failed";`);
      params.purchaseId = rid(creditPurchaseId);
    }

    if (stmts.length > 0) {
      await db.query(stmts.join("\n"), params);

      await Core.getInstance().reloadSubscription(
        String(sub.companyId),
        String(sub.systemId),
      );
    }

    if (ownerEmail) {
      await publish("SEND_EMAIL", {
        recipients: [ownerEmail],
        template: "payment-failure",
        templateData: {
          name: ownerName,
          systemName,
          kind,
          amount: String(chargeAmount),
          currency,
          reason: failureReason || "billing.payment.genericFailure",
          billingUrl,
        },
        systemSlug,
      });
    }
  }
};
