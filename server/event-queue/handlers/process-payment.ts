import type { HandlerFn } from "../worker.ts";
import { getDb, rid } from "../../db/connection.ts";
import { publish } from "../publisher.ts";
import Core from "../../utils/Core.ts";
import { resolveAllOperationCounts } from "../../utils/guards.ts";
import type { PaymentResult } from "../../../src/contracts/payment-provider.ts";

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
  const isRetry = purpose === "retry";
  const db = await getDb();

  // Batch: subscription + plan + voucher + owner info + system info (§7.2)
  const creditPurchaseQuery = creditPurchaseId
    ? `SELECT status FROM credit_purchase WHERE id = $purchaseId LIMIT 1;`
    : `SELECT NONE FROM NONE;`;

  const result = await db.query<
    [
      {
        id: string;
        planId: string;
        paymentMethodId: string;
        companyId: string;
        systemId: string;
        status: string;
        currentPeriodEnd: string;
        voucherId: string | null;
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
    `SELECT * FROM subscription WHERE id = $id LIMIT 1;
     LET $planId = (SELECT VALUE planId FROM subscription WHERE id = $id LIMIT 1)[0];
     SELECT price, recurrenceDays, planCredits, currency FROM plan WHERE id = $planId LIMIT 1;
     LET $voucherId = (SELECT VALUE voucherId FROM subscription WHERE id = $id LIMIT 1)[0];
     IF $voucherId != NONE {
       SELECT priceModifier, creditModifier FROM voucher WHERE id = $voucherId LIMIT 1;
     } ELSE {
       SELECT NONE FROM NONE;
     };
     LET $companyId = (SELECT VALUE companyId FROM subscription WHERE id = $id LIMIT 1)[0];
     LET $ownerId = (SELECT VALUE ownerId FROM company WHERE id = $companyId LIMIT 1)[0];
     SELECT email, profile.name AS name FROM user WHERE id = $ownerId LIMIT 1 FETCH profile;
     LET $systemId = (SELECT VALUE systemId FROM subscription WHERE id = $id LIMIT 1)[0];
     SELECT name, slug FROM system WHERE id = $systemId LIMIT 1;
     ${creditPurchaseQuery}`,
    {
      id: rid(subscriptionId),
      purchaseId: creditPurchaseId ? rid(creditPurchaseId) : undefined,
    },
  );

  const sub = result[0]?.[0];
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
  const purchaseStatus = result[5]?.[0]?.status;
  if (creditPurchaseId && purchaseStatus && purchaseStatus !== "pending") {
    console.log(
      `[payment] Credit purchase ${creditPurchaseId} already processed (${purchaseStatus}), skipping.`,
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
    const paymentResult = await db.query<[{ id: string }[]]>(
      `CREATE payment SET
        companyId = $companyId,
        systemId = $systemId,
        subscriptionId = $subId,
        amount = $amount,
        currency = $currency,
        kind = $kind,
        status = "pending",
        paymentMethodId = $pmId`,
      {
        companyId: rid(String(sub.companyId)),
        systemId: rid(String(sub.systemId)),
        subId: rid(sub.id),
        amount: chargeAmount,
        currency,
        kind,
        pmId: rid(sub.paymentMethodId),
      },
    );
    paymentId = paymentResult[0]?.[0]?.id;
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
  const ownerEmail = owner?.email ?? "";

  // Async payment detection (§22.9)
  const isAsync = providerResult.expiresInSeconds != null &&
    providerResult.continuityData != null;

  if (isAsync) {
    const expiresAt = new Date(
      Date.now() + providerResult.expiresInSeconds! * 1000,
    );

    if (paymentId) {
      await db.query(
        `UPDATE $paymentId SET
          continuityData = $continuityData,
          expiresAt = $expiresAt
         WHERE id = $paymentId;`,
        {
          paymentId: rid(String(paymentId)),
          continuityData: providerResult.continuityData,
          expiresAt,
        },
      );
    }

    // Send payment-pending notification (§22.9)
    if (ownerEmail) {
      await publish("SEND_EMAIL", {
        recipients: [ownerEmail],
        template: "payment-pending",
        templateData: {
          name: ownerName,
          systemName,
          kind,
          amount: String(chargeAmount),
          currency,
          billingUrl,
          expiresInSeconds: String(providerResult.expiresInSeconds),
          continuityData: providerResult.continuityData,
        },
        systemSlug,
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

      // Batch: update subscription + update payment record (§7.2)
      const statusClause = isRetry
        ? `status = "active", retryPaymentInProgress = false,`
        : `retryPaymentInProgress = false,`;
      const paymentStmt = paymentId
        ? `UPDATE $paymentId SET status = "completed", transactionId = $txId, invoiceUrl = $invoiceUrl;`
        : "";

      await db.query(
        `UPDATE $id SET
          ${statusClause}
          currentPeriodStart = $newStart,
          currentPeriodEnd = $newEnd,
          remainingPlanCredits = $remainingPlanCredits,
          remainingOperationCount = $remainingOperationCount,
          creditAlertSent = false,
          operationCountAlertSent = {};
         ${paymentStmt}`,
        {
          id: rid(sub.id),
          newStart,
          newEnd,
          remainingPlanCredits,
          remainingOperationCount,
          paymentId: paymentId ? rid(String(paymentId)) : undefined,
          txId: undefined,
          invoiceUrl: invoiceUrl || undefined,
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
        stmts.push(`UPDATE $purchaseId SET status = "completed";`);
        params.purchaseId = rid(creditPurchaseId);
      }
      if (purpose === "auto-recharge") {
        stmts.push(`UPDATE $subId SET autoRechargeInProgress = false;`);
      }

      // Reset credit alert on credit purchase success (§22.3)
      stmts.push(`UPDATE $subId SET creditAlertSent = false;`);

      // Update payment record to completed
      if (paymentId) {
        stmts.push(
          `UPDATE $paymentId SET status = "completed", transactionId = $txId, invoiceUrl = $invoiceUrl;`,
        );
        params.paymentId = rid(String(paymentId));
        params.txId = undefined;
        params.invoiceUrl = invoiceUrl || undefined;
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
          invoiceUrl,
        },
        systemSlug,
      });
    }
  } else {
    // Payment failed — single batched query (§7.2)
    const stmts: string[] = [];
    const params: Record<string, unknown> = { subId: rid(sub.id) };

    // Merge all subscription updates into one statement
    const subSets: string[] = [];
    if (isRecurring) subSets.push(`status = "past_due"`);
    if (isRetry || isRecurring) subSets.push(`retryPaymentInProgress = false`);
    if (purpose === "auto-recharge") {
      subSets.push(`autoRechargeInProgress = false`);
    }
    if (subSets.length > 0) {
      stmts.push(`UPDATE $subId SET ${subSets.join(", ")};`);
    }

    if (creditPurchaseId) {
      stmts.push(`UPDATE $purchaseId SET status = "failed";`);
      params.purchaseId = rid(creditPurchaseId);
    }
    if (paymentId) {
      stmts.push(
        `UPDATE $paymentId SET status = "failed", failureReason = $reason;`,
      );
      params.paymentId = rid(String(paymentId));
      params.reason = failureReason || "billing.payment.genericFailure";
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
