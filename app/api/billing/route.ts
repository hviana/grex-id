import { NextRequest, NextResponse } from "next/server";
import { getDb, rid } from "@/server/db/connection";
import { compose } from "@/server/middleware/compose";
import { withAuth } from "@/server/middleware/withAuth";
import type { RequestContext } from "@/src/contracts/auth";

async function getHandler(req: NextRequest, ctx: RequestContext) {
  const url = new URL(req.url);
  const companyId = url.searchParams.get("companyId");
  const systemId = url.searchParams.get("systemId");

  if (!companyId || !systemId) {
    return NextResponse.json(
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

  return NextResponse.json({
    success: true,
    data: {
      subscriptions: result[0] ?? [],
      paymentMethods: result[1] ?? [],
      creditPurchases: result[2] ?? [],
      creditsBalance: result[3]?.[0]?.balance ?? 0,
    },
  });
}

async function postHandler(req: NextRequest, ctx: RequestContext) {
  const body = await req.json();
  const { action } = body;

  const db = await getDb();

  if (action === "subscribe") {
    const { companyId, systemId, planId, paymentMethodId } = body;

    if (!companyId || !systemId || !planId) {
      return NextResponse.json(
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

    const userId = ctx.claims?.actorId ?? null;

    const plans = await db.query<
      [{ recurrenceDays: number; price: number; planCredits: number }[]]
    >(
      "SELECT recurrenceDays, price, planCredits FROM plan WHERE id = $planId LIMIT 1",
      { planId: rid(planId) },
    );
    const plan = plans[0]?.[0];
    if (!plan) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "NOT_FOUND", message: "billing.plans.notFound" },
        },
        { status: 404 },
      );
    }

    if (plan.price > 0 && !paymentMethodId) {
      return NextResponse.json(
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

    const now = new Date();
    const periodEnd = new Date(now.getTime() + plan.recurrenceDays * 86400000);

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

    return NextResponse.json({ success: true, data: result }, { status: 201 });
  }

  if (action === "cancel") {
    const { companyId, systemId } = body;

    if (!companyId || !systemId) {
      return NextResponse.json(
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

    await db.query(
      `UPDATE subscription SET status = "cancelled"
       WHERE companyId = $companyId AND systemId = $systemId AND status = "active"`,
      { companyId: rid(companyId), systemId: rid(systemId) },
    );

    return NextResponse.json({ success: true });
  }

  if (action === "add_payment_method") {
    const {
      companyId,
      cardToken,
      cardMask,
      holderName,
      holderDocument,
      billingAddress,
    } = body;

    if (
      !companyId || !cardToken || !cardMask || !holderName || !billingAddress
    ) {
      return NextResponse.json(
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

    return NextResponse.json(
      { success: true, data: result[3]?.[0] },
      { status: 201 },
    );
  }

  if (action === "set_default_payment_method") {
    const { companyId, paymentMethodId } = body;

    if (!companyId || !paymentMethodId) {
      return NextResponse.json(
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

    return NextResponse.json({ success: true });
  }

  if (action === "remove_payment_method") {
    const { paymentMethodId } = body;

    if (!paymentMethodId) {
      return NextResponse.json(
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

    return NextResponse.json({ success: true });
  }

  if (action === "purchase_credits") {
    const { companyId, systemId, amount, paymentMethodId } = body;

    if (!companyId || !systemId || !amount || !paymentMethodId) {
      return NextResponse.json(
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

    const result = await db.query<[Record<string, unknown>[]]>(
      `CREATE credit_purchase SET
        companyId = $companyId,
        systemId = $systemId,
        amount = $amount,
        paymentMethodId = $paymentMethodId,
        status = "pending";
       UPDATE subscription SET creditAlertSent = false
        WHERE companyId = $companyId AND systemId = $systemId AND status = "active";`,
      {
        companyId: rid(companyId),
        systemId: rid(systemId),
        amount: Number(amount),
        paymentMethodId: rid(paymentMethodId),
      },
    );

    return NextResponse.json(
      { success: true, data: result[0]?.[0] },
      { status: 201 },
    );
  }

  if (action === "apply_voucher") {
    const { companyId, systemId, voucherCode } = body;

    if (!companyId || !systemId || !voucherCode) {
      return NextResponse.json(
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

    const vouchers = await db.query<[Record<string, unknown>[]]>(
      `SELECT * FROM voucher WHERE code = $code LIMIT 1`,
      { code: voucherCode },
    );
    const voucher = vouchers[0]?.[0];

    if (!voucher) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "NOT_FOUND", message: "billing.voucher.error.invalid" },
        },
        { status: 404 },
      );
    }

    if (
      voucher.expiresAt &&
      new Date(voucher.expiresAt as string) < new Date()
    ) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "EXPIRED", message: "billing.voucher.error.expired" },
        },
        { status: 400 },
      );
    }

    // Check applicableCompanyIds (empty = universal)
    const applicableIds = voucher.applicableCompanyIds as string[];
    if (applicableIds && applicableIds.length > 0) {
      const companyIdStr = String(companyId);
      if (!applicableIds.some((id) => String(id) === companyIdStr)) {
        return NextResponse.json(
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

    // Check applicablePlanIds (empty = valid for all plans)
    const applicablePlanIds = voucher.applicablePlanIds as string[];
    if (applicablePlanIds && applicablePlanIds.length > 0) {
      const sub = await db.query<[ { planId: string }[] ]>(
        `SELECT planId FROM subscription
         WHERE companyId = $companyId AND systemId = $systemId AND status = "active"
         LIMIT 1`,
        { companyId: rid(companyId), systemId: rid(systemId) },
      );
      const currentPlanId = String(sub[0]?.[0]?.planId ?? "");
      if (
        !currentPlanId ||
        !applicablePlanIds.some((id) => String(id) === currentPlanId)
      ) {
        return NextResponse.json(
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

    // Single voucher invariant: replace (not append)
    await db.query(
      `UPDATE subscription SET voucherId = $voucherId
       WHERE companyId = $companyId AND systemId = $systemId AND status = "active"`,
      {
        companyId: rid(companyId),
        systemId: rid(systemId),
        voucherId: rid(voucher.id as string),
      },
    );

    return NextResponse.json({
      success: true,
      data: voucher,
      message: "billing.voucher.success",
    });
  }

  if (action === "set_auto_recharge") {
    const { companyId, systemId, enabled, amount } = body;

    if (!companyId || !systemId) {
      return NextResponse.json(
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

    if (enabled) {
      // Validate amount
      const minAmount = 500; // billing.autoRecharge.minAmount (default 500 cents)
      const maxAmount = 50000; // billing.autoRecharge.maxAmount (default 50000 cents)

      if (!amount || amount < minAmount) {
        return NextResponse.json(
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
        return NextResponse.json(
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

      // Verify default payment method exists
      const pm = await db.query<[{ id: string }[]]>(
        `SELECT id FROM payment_method WHERE companyId = $companyId AND isDefault = true LIMIT 1`,
        { companyId: rid(companyId) },
      );
      if (!pm[0] || pm[0].length === 0) {
        return NextResponse.json(
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

      await db.query(
        `UPDATE subscription SET
          autoRechargeEnabled = true,
          autoRechargeAmount = $amount
         WHERE companyId = $companyId AND systemId = $systemId AND status = "active"`,
        {
          companyId: rid(companyId),
          systemId: rid(systemId),
          amount: Number(amount),
        },
      );
    } else {
      // Disable auto-recharge
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

    return NextResponse.json({ success: true });
  }

  return NextResponse.json(
    {
      success: false,
      error: { code: "INVALID_ACTION", message: "common.error.invalidAction" },
    },
    { status: 400 },
  );
}

export const GET = compose(
  withAuth({ requireAuthenticated: true }),
  async (req, _ctx, next) =>
    getHandler(req as NextRequest, _ctx),
);

export const POST = compose(
  withAuth({ requireAuthenticated: true }),
  async (req, _ctx, next) =>
    postHandler(req as NextRequest, _ctx),
);
