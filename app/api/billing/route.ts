import { compose } from "@/server/middleware/compose";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import { withAuth } from "@/server/middleware/withAuth";
import type { RequestContext } from "@/src/contracts/auth";
import { getDb, rid } from "@/server/db/connection";
import Core from "@/server/utils/Core";
import { publish } from "@/server/event-queue/publisher";

function tenantGuard(ctx: RequestContext): Response | null {
  if (ctx.tenant.companyId === "0" || ctx.tenant.systemId === "0") {
    return Response.json(
      {
        success: false,
        error: {
          code: "VALIDATION",
          message: "validation.billing.companyAndSystem",
        },
      },
      { status: 400 },
    );
  }
  return null;
}

async function getHandler(req: Request, ctx: RequestContext) {
  // §9.2: read companyId/systemId from ctx.tenant only
  const guard = tenantGuard(ctx);
  if (guard) return guard;

  const { companyId, systemId } = ctx.tenant;
  const url = new URL(req.url);
  const includePayments = url.searchParams.get("include")?.includes("payments");
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");
  const paymentCursor = url.searchParams.get("cursor");

  // Validate date range (max 365 days) when requesting payments
  if (includePayments && startDate && endDate) {
    const diffMs = new Date(endDate).getTime() - new Date(startDate).getTime();
    if (diffMs > 365 * 86400000) {
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            message: "validation.dateRange.maxDays",
          },
        },
        { status: 400 },
      );
    }
  }

  const db = await getDb();

  // Build payment history query if requested (§7.1 cursor-based, §7.2 single call)
  let paymentQuery = "";
  const queryParams: Record<string, unknown> = {
    companyId: rid(companyId),
    systemId: rid(systemId),
  };

  if (includePayments) {
    const whereClauses = ["companyId = $companyId", "systemId = $systemId"];
    if (startDate) {
      whereClauses.push("createdAt >= $startDate");
      queryParams.startDate = new Date(startDate).toISOString();
    }
    if (endDate) {
      whereClauses.push("createdAt <= $endDate");
      queryParams.endDate = new Date(endDate).toISOString();
    }
    // Cursor-based pagination on createdAt (§7.1) — cursor is the ISO date of the last row
    if (paymentCursor) {
      whereClauses.push("createdAt < $cursorDate");
      queryParams.cursorDate = new Date(atob(paymentCursor)).toISOString();
    }
    const whereStr = whereClauses.join(" AND ");
    paymentQuery =
      `SELECT * FROM payment WHERE ${whereStr} ORDER BY createdAt DESC LIMIT 21;`;
  }

  const result = await db.query<
    [
      Record<string, unknown>[],
      Record<string, unknown>[],
      Record<string, unknown>[],
      Record<string, unknown>[],
      Record<string, unknown>[]?,
      Record<string, unknown>[]?,
    ]
  >(
    `SELECT * FROM subscription WHERE companyId = $companyId AND systemId = $systemId ORDER BY createdAt DESC FETCH voucherId;
     SELECT * FROM payment_method WHERE companyId = $companyId ORDER BY isDefault DESC, createdAt DESC FETCH billingAddress;
     SELECT * FROM credit_purchase WHERE companyId = $companyId AND systemId = $systemId ORDER BY createdAt DESC LIMIT 20;
     SELECT math::sum(value) AS balance FROM usage_record WHERE companyId = $companyId AND systemId = $systemId AND resource = "credits";
     ${paymentQuery}
     SELECT id, amount, currency, kind, continuityData, expiresAt, createdAt
       FROM payment
       WHERE companyId = $companyId
         AND systemId = $systemId
         AND status = "pending"
         AND continuityData IS NOT NONE
       ORDER BY createdAt DESC
       LIMIT 10;`,
    queryParams,
  );

  const responseData: Record<string, unknown> = {
    subscriptions: result[0] ?? [],
    paymentMethods: result[1] ?? [],
    creditPurchases: result[2] ?? [],
    creditsBalance: result[3]?.[0]?.balance ?? 0,
  };

  if (includePayments) {
    const paymentRows: Record<string, unknown>[] = result[4] ?? [];
    const hasMore = paymentRows.length > 20;
    const paymentData = hasMore ? paymentRows.slice(0, 20) : paymentRows;
    const lastRow = paymentData[paymentData.length - 1];
    responseData.payments = paymentData;
    responseData.paymentsNextCursor = hasMore && lastRow
      ? btoa(String(lastRow.createdAt))
      : null;
  }

  responseData.pendingAsyncPayments = result[5] ?? [];

  return Response.json({
    success: true,
    data: responseData,
  });
}

async function postHandler(req: Request, ctx: RequestContext) {
  const body = await req.json();
  const { action } = body;

  const db = await getDb();
  const core = Core.getInstance();
  // §9.2: companyId/systemId come from ctx.tenant, except subscribe which
  // accepts them from body for the onboarding flow (user hasn't exchanged yet)
  const companyId = action === "subscribe" && body.companyId
    ? body.companyId
    : ctx.tenant.companyId;
  const systemId = action === "subscribe" && body.systemId
    ? body.systemId
    : ctx.tenant.systemId;

  if (action === "subscribe") {
    const { planId, paymentMethodId } = body;

    if (!planId) {
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            message: "validation.billing.subscribeFields",
          },
        },
        { status: 400 },
      );
    }

    // Use Core cache for plan lookup (no db.query) — §7.2 single-call rule
    const plan = await core.getPlanById(planId);
    if (!plan || String(plan.systemId) !== String(systemId)) {
      return Response.json(
        {
          success: false,
          error: { code: "NOT_FOUND", message: "billing.plans.notFound" },
        },
        { status: 404 },
      );
    }

    if (plan.price > 0 && !paymentMethodId) {
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            message: "billing.paymentMethods.required",
          },
        },
        { status: 400 },
      );
    }

    // During onboarding, companyId/systemId may come from body before token exchange
    if (!body.companyId && !body.systemId) {
      const guard = tenantGuard(ctx);
      if (guard) return guard;
    }

    // Read plan's maxOperationCount directly — resolveMaxOperationCount
    // cannot be used here because no subscription exists yet (returns 0)
    const operationCountCap = plan.maxOperationCount ?? 0;

    const userId = ctx.claims?.actorId ?? null;
    const now = new Date();
    const periodEnd = new Date(
      now.getTime() + (plan.recurrenceDays ?? 30) * 86400000,
    );

    const params: Record<string, unknown> = {
      companyId: rid(companyId),
      systemId: rid(systemId),
      planId: rid(planId),
      planCredits: plan.planCredits ?? 0,
      operationCountCap,
      start: now,
      end: periodEnd,
    };
    if (paymentMethodId) {
      params.paymentMethodId = rid(paymentMethodId);
    }
    if (userId) {
      params.userId = rid(userId);
    }

    const ucsClause = userId
      ? `IF array::len((SELECT id FROM user_company_system WHERE userId = $userId AND companyId = $companyId AND systemId = $systemId)) = 0 {
           CREATE user_company_system SET userId = $userId, companyId = $companyId, systemId = $systemId, roles = ["admin"];
         };`
      : "";

    const result = await db.query(
      `IF array::len((SELECT id FROM company_system WHERE companyId = $companyId AND systemId = $systemId)) = 0 {
         CREATE company_system SET companyId = $companyId, systemId = $systemId;
       };
       UPDATE subscription SET status = "cancelled" WHERE companyId = $companyId AND systemId = $systemId AND status = "active";
       CREATE subscription SET
         companyId = $companyId,
         systemId = $systemId,
         planId = $planId,
         paymentMethodId = ${paymentMethodId ? "$paymentMethodId" : "NONE"},
         status = "active",
         currentPeriodStart = $start,
         currentPeriodEnd = $end,
         voucherId = NONE,
         remainingPlanCredits = $planCredits,
         remainingOperationCount = $operationCountCap,
         creditAlertSent = false,
         operationCountAlertSent = false,
         autoRechargeEnabled = false,
         autoRechargeAmount = 0,
         autoRechargeInProgress = false,
         retryPaymentInProgress = false;
       ${ucsClause}`,
      params,
    );

    await Core.getInstance().reloadSubscription(
      String(companyId),
      String(systemId),
    );

    return Response.json({ success: true, data: result }, { status: 201 });
  }

  if (action === "cancel") {
    const guard = tenantGuard(ctx);
    if (guard) return guard;

    await db.query(
      `UPDATE subscription SET status = "cancelled"
       WHERE companyId = $companyId AND systemId = $systemId AND status = "active"`,
      { companyId: rid(companyId), systemId: rid(systemId) },
    );

    await Core.getInstance().reloadSubscription(companyId, systemId);

    return Response.json({ success: true });
  }

  if (action === "add_payment_method") {
    const {
      cardToken,
      cardMask,
      holderName,
      holderDocument,
      billingAddress,
    } = body;

    if (
      !cardToken || !cardMask || !holderName || !billingAddress
    ) {
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            message: "validation.billing.paymentMethodFields",
          },
        },
        { status: 400 },
      );
    }

    const addr = billingAddress;
    const result = await db.query<
      [unknown, unknown, unknown, Record<string, unknown>[]]
    >(
      `LET $addr = CREATE address SET
        street = $street,
        number = $number,
        complement = $complement,
        neighborhood = $neighborhood,
        city = $city,
        state = $state,
        country = $country,
        postalCode = $postalCode;
      LET $existingCount = (SELECT count() FROM payment_method WHERE companyId = $companyId GROUP ALL).count ?? 0;
      LET $pm = CREATE payment_method SET
        companyId = $companyId,
        type = "credit_card",
        cardMask = $cardMask,
        cardToken = $cardToken,
        holderName = $holderName,
        holderDocument = $holderDocument,
        billingAddress = $addr[0].id,
        isDefault = IF $existingCount = 0 THEN true ELSE false END;
      SELECT * FROM $pm[0].id FETCH billingAddress;`,
      {
        street: addr.street ?? "",
        number: addr.number ?? "",
        complement: addr.complement || undefined,
        neighborhood: addr.neighborhood || undefined,
        city: addr.city ?? "",
        state: addr.state ?? "",
        country: addr.country ?? "",
        postalCode: addr.postalCode ?? "",
        companyId: rid(companyId),
        cardMask,
        cardToken,
        holderName,
        holderDocument: holderDocument ?? "",
      },
    );

    return Response.json(
      { success: true, data: result[3]?.[0] },
      { status: 201 },
    );
  }

  if (action === "set_default_payment_method") {
    const { paymentMethodId } = body;

    if (!paymentMethodId) {
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            message: "validation.billing.paymentMethodFields",
          },
        },
        { status: 400 },
      );
    }

    await db.query(
      `UPDATE payment_method SET isDefault = false WHERE companyId = $companyId;
       UPDATE $pmId SET isDefault = true;`,
      { companyId: rid(companyId), pmId: rid(paymentMethodId) },
    );

    return Response.json({ success: true });
  }

  if (action === "remove_payment_method") {
    const { paymentMethodId } = body;

    if (!paymentMethodId) {
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            message: "validation.billing.paymentMethodFields",
          },
        },
        { status: 400 },
      );
    }

    await db.query(
      `LET $pm = (SELECT billingAddress, companyId, isDefault FROM $id);
       DELETE $id;
       IF $pm[0].billingAddress != NONE {
         DELETE $pm[0].billingAddress;
       };
       IF $pm[0].isDefault = true {
         LET $next = (SELECT id FROM payment_method WHERE companyId = $pm[0].companyId LIMIT 1);
         IF $next[0].id != NONE {
           UPDATE $next[0].id SET isDefault = true;
         };
       };`,
      { id: rid(paymentMethodId) },
    );

    return Response.json({ success: true });
  }

  if (action === "purchase_credits") {
    const { amount, paymentMethodId } = body;

    if (!amount || !paymentMethodId) {
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            message: "validation.billing.creditPurchaseFields",
          },
        },
        { status: 400 },
      );
    }

    const guard = tenantGuard(ctx);
    if (guard) return guard;

    const result = await db.query<
      [Record<string, unknown>[], { id: string }[]]
    >(
      `CREATE credit_purchase SET
        companyId = $companyId,
        systemId = $systemId,
        amount = $amount,
        paymentMethodId = $paymentMethodId,
        status = "pending";
       UPDATE subscription SET creditAlertSent = false
        WHERE companyId = $companyId AND systemId = $systemId AND status = "active";
       SELECT id FROM subscription
        WHERE companyId = $companyId AND systemId = $systemId AND status = "active"
        LIMIT 1;`,
      {
        companyId: rid(companyId),
        systemId: rid(systemId),
        amount: Number(amount),
        paymentMethodId: rid(paymentMethodId),
      },
    );

    const purchase = result[0]?.[0];
    const activeSubId = result[1]?.[0]?.id;

    await publish("PAYMENT_DUE", {
      creditPurchaseId: String(purchase?.id ?? ""),
      subscriptionId: String(activeSubId ?? ""),
      companyId,
      systemId,
      amount: String(amount),
      purpose: "credits",
    });

    await Core.getInstance().reloadSubscription(companyId, systemId);

    return Response.json(
      { success: true, data: purchase },
      { status: 201 },
    );
  }

  if (action === "apply_voucher") {
    const { voucherCode } = body;

    if (!voucherCode) {
      return Response.json(
        {
          success: false,
          error: {
            code: "VALIDATION",
            message: "validation.billing.voucherFields",
          },
        },
        { status: 400 },
      );
    }

    const guard = tenantGuard(ctx);
    if (guard) return guard;

    // Batch: voucher + current subscription + old voucher creditModifier & maxOperationCountModifier (§7.2)
    const batchResult = await db.query<
      [
        Record<string, unknown>[],
        { planId: string; voucherId: string | null }[],
        { creditModifier: number; maxOperationCountModifier: number }[],
      ]
    >(
      `SELECT * FROM voucher WHERE code = $code LIMIT 1;
       SELECT planId, voucherId FROM subscription
         WHERE companyId = $companyId AND systemId = $systemId AND status = "active"
         LIMIT 1;
       LET $oldVoucherId = (SELECT VALUE voucherId FROM subscription
         WHERE companyId = $companyId AND systemId = $systemId AND status = "active"
         LIMIT 1)[0];
       IF $oldVoucherId != NONE {
         SELECT creditModifier, maxOperationCountModifier FROM voucher WHERE id = $oldVoucherId LIMIT 1;
       } ELSE {
         SELECT NONE FROM NONE;
       };`,
      { code: voucherCode, companyId: rid(companyId), systemId: rid(systemId) },
    );

    const voucher = batchResult[0]?.[0];

    if (!voucher) {
      return Response.json(
        {
          success: false,
          error: {
            code: "NOT_FOUND",
            message: "billing.voucher.error.invalid",
          },
        },
        { status: 404 },
      );
    }

    if (
      voucher.expiresAt &&
      new Date(voucher.expiresAt as string) < new Date()
    ) {
      return Response.json(
        {
          success: false,
          error: { code: "EXPIRED", message: "billing.voucher.error.expired" },
        },
        { status: 400 },
      );
    }

    const applicableIds = voucher.applicableCompanyIds as string[];
    if (applicableIds && applicableIds.length > 0) {
      const companyIdStr = String(companyId);
      if (!applicableIds.some((id) => String(id) === companyIdStr)) {
        return Response.json(
          {
            success: false,
            error: {
              code: "NOT_APPLICABLE",
              message: "billing.voucher.error.invalid",
            },
          },
          { status: 400 },
        );
      }
    }

    const applicablePlanIds = voucher.applicablePlanIds as string[];
    const currentPlanId = String(batchResult[1]?.[0]?.planId ?? "");
    if (applicablePlanIds && applicablePlanIds.length > 0) {
      if (
        !currentPlanId ||
        !applicablePlanIds.some((id) => String(id) === currentPlanId)
      ) {
        return Response.json(
          {
            success: false,
            error: {
              code: "NOT_APPLICABLE",
              message: "billing.voucher.planNotApplicable",
            },
          },
          { status: 400 },
        );
      }
    }

    const oldCreditMod = Number(batchResult[2]?.[0]?.creditModifier ?? 0);
    const newCreditMod = Number(voucher.creditModifier ?? 0);
    const creditDelta = newCreditMod - oldCreditMod;

    const oldOpCountMod = Number(
      batchResult[2]?.[0]?.maxOperationCountModifier ?? 0,
    );
    const newOpCountMod = Number(voucher.maxOperationCountModifier ?? 0);
    const opCountDelta = newOpCountMod - oldOpCountMod;

    const creditClause = creditDelta !== 0
      ? ", remainingPlanCredits = remainingPlanCredits + $creditDelta"
      : "";
    const opCountClause = opCountDelta !== 0
      ? ", remainingOperationCount = math::max(0, remainingOperationCount + $opCountDelta), operationCountAlertSent = false"
      : "";

    const updateQuery = creditClause || opCountClause
      ? `UPDATE subscription SET voucherId = $voucherId${creditClause}${opCountClause}
         WHERE companyId = $companyId AND systemId = $systemId AND status = "active"`
      : `UPDATE subscription SET voucherId = $voucherId
         WHERE companyId = $companyId AND systemId = $systemId AND status = "active"`;

    await db.query(updateQuery, {
      companyId: rid(companyId),
      systemId: rid(systemId),
      voucherId: rid(voucher.id as string),
      ...(creditDelta !== 0 ? { creditDelta } : {}),
      ...(opCountDelta !== 0 ? { opCountDelta } : {}),
    });

    await Core.getInstance().reloadSubscription(companyId, systemId);

    return Response.json({
      success: true,
      data: voucher,
      message: "billing.voucher.success",
    });
  }

  if (action === "set_auto_recharge") {
    const { enabled, amount } = body;

    const guard = tenantGuard(ctx);
    if (guard) return guard;

    if (enabled) {
      const minAmount = Number(
        (await core.getSetting(
          "billing.autoRecharge.minAmount",
          ctx.tenant.systemSlug,
        )) ?? "500",
      );
      const maxAmount = Number(
        (await core.getSetting(
          "billing.autoRecharge.maxAmount",
          ctx.tenant.systemSlug,
        )) ?? "50000",
      );

      if (!amount || amount < minAmount) {
        return Response.json(
          {
            success: false,
            error: {
              code: "VALIDATION",
              message: "validation.amount.tooSmall",
            },
          },
          { status: 400 },
        );
      }

      if (amount > maxAmount) {
        return Response.json(
          {
            success: false,
            error: {
              code: "VALIDATION",
              message: "validation.amount.tooLarge",
            },
          },
          { status: 400 },
        );
      }

      // Batch: check payment method + update subscription in one query (§7.2)
      const pmResult = await db.query<
        [{ id: string }[], unknown[]]
      >(
        `LET $pm = (SELECT id FROM payment_method WHERE companyId = $companyId AND isDefault = true LIMIT 1);
         IF array::len($pm) > 0 {
           UPDATE subscription SET
             autoRechargeEnabled = true,
             autoRechargeAmount = $amount
           WHERE companyId = $companyId AND systemId = $systemId AND status = "active";
         };
         RETURN $pm;`,
        {
          companyId: rid(companyId),
          systemId: rid(systemId),
          amount: Number(amount),
        },
      );

      const pm = pmResult[1];
      if (
        !pm || (Array.isArray(pm) && pm.length === 0) ||
        (pm as any)[0]?.id === undefined
      ) {
        return Response.json(
          {
            success: false,
            error: {
              code: "VALIDATION",
              message: "billing.autoRecharge.noDefaultPaymentMethod",
            },
          },
          { status: 400 },
        );
      }
    } else {
      await db.query(
        `UPDATE subscription SET
          autoRechargeEnabled = false,
          autoRechargeAmount = 0,
          autoRechargeInProgress = false
         WHERE companyId = $companyId AND systemId = $systemId AND status = "active"`,
        {
          companyId: rid(companyId),
          systemId: rid(systemId),
        },
      );
    }

    await Core.getInstance().reloadSubscription(companyId, systemId);

    return Response.json({ success: true });
  }

  if (action === "retry_payment") {
    const guard = tenantGuard(ctx);
    if (guard) return guard;

    // Batch: lookup + guard update in one query (§7.2)
    const retryResult = await db.query<
      [{ result: string; id?: string }[]]
    >(
      `LET $sub = (SELECT id, retryPaymentInProgress FROM subscription
         WHERE companyId = $companyId AND systemId = $systemId AND status = "past_due"
         LIMIT 1);
       IF array::len($sub) = 0 {
         RETURN [{ result: "not_found" }];
       } ELSE IF $sub[0].retryPaymentInProgress = true {
         RETURN [{ result: "conflict" }];
       } ELSE {
         UPDATE $sub[0].id SET retryPaymentInProgress = true;
         RETURN [{ result: "ok", id: $sub[0].id }];
       };`,
      { companyId: rid(companyId), systemId: rid(systemId) },
    );

    const retryRow = retryResult[0]?.[0];
    if (!retryRow || retryRow.result === "not_found") {
      return Response.json(
        {
          success: false,
          error: { code: "NOT_FOUND", message: "billing.retry.noPastDue" },
        },
        { status: 404 },
      );
    }

    if (retryRow.result === "conflict") {
      return Response.json(
        {
          success: false,
          error: { code: "CONFLICT", message: "billing.retry.inProgress" },
        },
        { status: 409 },
      );
    }

    await publish("PAYMENT_DUE", {
      subscriptionId: String(retryRow.id),
      companyId,
      systemId,
      purpose: "retry",
    });

    await Core.getInstance().reloadSubscription(companyId, systemId);

    return Response.json({ success: true });
  }

  return Response.json(
    {
      success: false,
      error: { code: "INVALID_ACTION", message: "common.error.invalidAction" },
    },
    { status: 400 },
  );
}

export const GET = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ requireAuthenticated: true }),
  async (req, ctx) => getHandler(req, ctx),
);

export const POST = compose(
  withRateLimit({ windowMs: 60_000, maxRequests: 60 }),
  withAuth({ requireAuthenticated: true }),
  async (req, ctx) => postHandler(req, ctx),
);
