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

  const db = await getDb();

  const result = await db.query<
    [
      Record<string, unknown>[],
      Record<string, unknown>[],
      Record<string, unknown>[],
      Record<string, unknown>[],
    ]
  >(
    `SELECT * FROM subscription WHERE companyId = $companyId AND systemId = $systemId ORDER BY createdAt DESC FETCH voucherId;
     SELECT * FROM payment_method WHERE companyId = $companyId ORDER BY isDefault DESC, createdAt DESC FETCH billingAddress;
     SELECT * FROM credit_purchase WHERE companyId = $companyId AND systemId = $systemId ORDER BY createdAt DESC LIMIT 20;
     SELECT math::sum(value) AS balance FROM usage_record WHERE companyId = $companyId AND systemId = $systemId AND resource = "credits";`,
    { companyId: rid(companyId), systemId: rid(systemId) },
  );

  return Response.json({
    success: true,
    data: {
      subscriptions: result[0] ?? [],
      paymentMethods: result[1] ?? [],
      creditPurchases: result[2] ?? [],
      creditsBalance: result[3]?.[0]?.balance ?? 0,
    },
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
         creditAlertSent = false,
         autoRechargeEnabled = false,
         autoRechargeAmount = 0,
         autoRechargeInProgress = false;
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

    // Batch: voucher + current subscription + old voucher creditIncrement (§7.2)
    const batchResult = await db.query<
      [
        Record<string, unknown>[],
        { planId: string; voucherId: string | null }[],
        { creditIncrement: number }[],
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
         SELECT creditIncrement FROM voucher WHERE id = $oldVoucherId LIMIT 1;
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

    const oldCreditInc = Number(batchResult[2]?.[0]?.creditIncrement ?? 0);
    const newCreditInc = Number(voucher.creditIncrement ?? 0);
    const creditDelta = newCreditInc - oldCreditInc;

    const updateQuery = creditDelta !== 0
      ? `UPDATE subscription SET voucherId = $voucherId, remainingPlanCredits = remainingPlanCredits + $creditDelta
         WHERE companyId = $companyId AND systemId = $systemId AND status = "active"`
      : `UPDATE subscription SET voucherId = $voucherId
         WHERE companyId = $companyId AND systemId = $systemId AND status = "active"`;

    await db.query(updateQuery, {
      companyId: rid(companyId),
      systemId: rid(systemId),
      voucherId: rid(voucher.id as string),
      ...(creditDelta !== 0 ? { creditDelta } : {}),
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
