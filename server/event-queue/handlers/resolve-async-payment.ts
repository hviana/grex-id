import type { HandlerFn } from "../worker.ts";
import { getDb, rid } from "../../db/connection.ts";
import { publish } from "../publisher.ts";
import Core from "../../utils/Core.ts";
import { resolveAllOperationCounts } from "../../utils/guards.ts";

if (typeof window !== "undefined") {
  throw new Error(
    "resolve-async-payment handler must not be imported in client-side code.",
  );
}

export const resolveAsyncPayment: HandlerFn = async (payload) => {
  const paymentId = payload.paymentId as string;
  const success = payload.success as boolean;
  const transactionId = payload.transactionId as string | undefined;
  const invoiceUrl = payload.invoiceUrl as string | undefined;
  const failureReason = payload.failureReason as string | undefined;
  const db = await getDb();

  // Batch: payment + subscription + plan + voucher + owner + system (§7.2)
  const result = await db.query<
    [
      {
        id: string;
        status: string;
        subscriptionId: string;
        companyId: string;
        systemId: string;
        amount: number;
        currency: string;
        kind: string;
      }[],
      {
        id: string;
        planId: string;
        paymentMethodId: string;
        status: string;
        currentPeriodEnd: string;
      }[],
      {
        price: number;
        recurrenceDays: number;
        planCredits: number;
        currency: string;
      }[],
      { priceModifier: number; creditModifier: number }[],
      { email: string; name: string }[],
      { name: string; slug: string }[],
      { status?: string }[],
    ]
  >(
    `SELECT id, status, subscriptionId, companyId, systemId, amount, currency, kind FROM payment WHERE id = $id LIMIT 1;
     LET $subId = (SELECT VALUE subscriptionId FROM payment WHERE id = $id LIMIT 1)[0];
     SELECT id, planId, paymentMethodId, status, currentPeriodEnd FROM subscription WHERE id = $subId LIMIT 1;
     LET $planId = (SELECT VALUE planId FROM subscription WHERE id = $subId LIMIT 1)[0];
     SELECT price, recurrenceDays, planCredits, currency FROM plan WHERE id = $planId LIMIT 1;
     LET $voucherId = (SELECT VALUE voucherId FROM subscription WHERE id = $subId LIMIT 1)[0];
     IF $voucherId != NONE {
       SELECT priceModifier, creditModifier FROM voucher WHERE id = $voucherId LIMIT 1;
     } ELSE {
       SELECT NONE FROM NONE;
     };
     LET $companyId = (SELECT VALUE companyId FROM payment WHERE id = $id LIMIT 1)[0];
     LET $ownerId = (SELECT VALUE ownerId FROM company WHERE id = $companyId LIMIT 1)[0];
     SELECT email, profile.name AS name FROM user WHERE id = $ownerId LIMIT 1 FETCH profile;
     LET $systemId = (SELECT VALUE systemId FROM payment WHERE id = $id LIMIT 1)[0];
     SELECT name, slug FROM system WHERE id = $systemId LIMIT 1;
     SELECT status FROM credit_purchase WHERE subscriptionId = $subId AND status = "pending" LIMIT 1;`,
    { id: rid(paymentId) },
  );

  const payment = result[0]?.[0];
  if (!payment) {
    console.log(
      `[resolve-async] Payment ${paymentId} not found, skipping.`,
    );
    return;
  }

  // Idempotency (§14.5): already resolved
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

  const sub = result[1]?.[0];
  const plan = result[2]?.[0];
  const voucher = result[3]?.[0];
  const owner = result[4]?.[0];
  const systemInfo = result[5]?.[0];
  const creditPurchase = result[6]?.[0];
  const systemName = systemInfo?.name ?? "";
  const systemSlug = systemInfo?.slug ?? "";
  const currency = plan?.currency ?? payment.currency ?? "USD";
  const kind = payment.kind;
  const chargeAmount = payment.amount;
  const isRecurring = kind === "recurring";

  const billingUrl = `/billing?system=${systemSlug}`;
  const ownerName = owner?.name ?? "";
  const ownerEmail = owner?.email ?? "";

  if (success) {
    if (isRecurring && sub) {
      // Recurring billing success — advance period, reset credits
      const newStart = new Date(sub.currentPeriodEnd);
      const newEnd = new Date(
        newStart.getTime() + (plan?.recurrenceDays ?? 30) * 86400000,
      );
      const creditModifier = voucher?.creditModifier ?? 0;
      const remainingPlanCredits = (plan?.planCredits ?? 0) + creditModifier;

      const remainingOperationCount = await resolveAllOperationCounts({
        companyId: String(payment.companyId),
        systemId: String(payment.systemId),
      });

      const creditPurchaseStmt = creditPurchase
        ? `UPDATE credit_purchase SET status = "done" WHERE subscriptionId = $subId AND status = "pending";`
        : "";

      await db.query(
        `UPDATE $subId SET
          status = "active",
          retryPaymentInProgress = false,
          currentPeriodStart = $newStart,
          currentPeriodEnd = $newEnd,
          remainingPlanCredits = $remainingPlanCredits,
          remainingOperationCount = $remainingOperationCount,
          creditAlertSent = false,
          operationCountAlertSent = false;
         UPDATE $paymentId SET
          status = "completed",
          transactionId = $txId,
          invoiceUrl = $invoiceUrl;
         ${creditPurchaseStmt}`,
        {
          subId: rid(sub.id),
          paymentId: rid(paymentId),
          newStart,
          newEnd,
          remainingPlanCredits,
          remainingOperationCount,
          txId: transactionId ?? undefined,
          invoiceUrl: invoiceUrl ?? undefined,
        },
      );
    } else {
      // Credit purchase or auto-recharge — increment purchased credits
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
        companyId: rid(String(payment.companyId)),
        systemId: rid(String(payment.systemId)),
        amount: chargeAmount,
        period,
        subId: sub ? rid(sub.id) : undefined,
        paymentId: rid(paymentId),
        txId: transactionId ?? undefined,
        invoiceUrl: invoiceUrl ?? undefined,
      };

      if (creditPurchase && sub) {
        stmts.push(
          `UPDATE credit_purchase SET status = "done" WHERE subscriptionId = $subId AND status = "pending";`,
        );
      }
      if (kind === "auto-recharge" && sub) {
        stmts.push(
          `UPDATE $subId SET autoRechargeInProgress = false;`,
        );
      }

      stmts.push(
        `UPDATE $paymentId SET status = "completed", transactionId = $txId, invoiceUrl = $invoiceUrl;`,
      );

      await db.query(stmts.join("\n"), params);
    }

    await Core.getInstance().reloadSubscription(
      String(payment.companyId),
      String(payment.systemId),
    );

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
          invoiceUrl,
        },
        systemSlug,
      });
    }
  } else {
    // Payment failed
    const stmts: string[] = [];
    const params: Record<string, unknown> = {
      subId: sub ? rid(sub.id) : undefined,
      paymentId: rid(paymentId),
    };

    const subSets: string[] = [];
    if (isRecurring) subSets.push(`status = "past_due"`);
    subSets.push(`retryPaymentInProgress = false`);
    if (kind === "auto-recharge") {
      subSets.push(`autoRechargeInProgress = false`);
    }
    if (subSets.length > 0 && sub) {
      stmts.push(`UPDATE $subId SET ${subSets.join(", ")};`);
    }

    if (creditPurchase) {
      stmts.push(
        `UPDATE credit_purchase SET status = "failed" WHERE subscriptionId = $subId AND status = "pending";`,
      );
    }

    stmts.push(
      `UPDATE $paymentId SET status = "failed", failureReason = $reason;`,
    );
    params.reason = failureReason || "billing.payment.genericFailure";

    await db.query(stmts.join("\n"), params);

    await Core.getInstance().reloadSubscription(
      String(payment.companyId),
      String(payment.systemId),
    );

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
