import { compose } from "@/server/middleware/compose";
import { withRateLimit } from "@/server/middleware/withRateLimit";
import { withAuth } from "@/server/middleware/withAuth";
import type { RequestContext } from "@/src/contracts/auth";
import Core from "@/server/utils/Core";
import { publish } from "@/server/event-queue/publisher";
import {
  addPaymentMethod,
  applyVoucherToSubscription,
  cancelSubscription,
  disableAutoRecharge,
  enableAutoRecharge,
  getBillingData,
  lookupVoucherAndSubscription,
  purchaseCredits,
  removePaymentMethod,
  retryPayment,
  setDefaultPaymentMethod,
  subscribe,
} from "@/server/db/queries/billing";

function tenantGuard(ctx: RequestContext): Response | null {
  if (!ctx.tenant.companyId || !ctx.tenant.systemId) {
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
  const guard = tenantGuard(ctx);
  if (guard) return guard;

  const url = new URL(req.url);
  const includePayments = url.searchParams.get("include")?.includes("payments");
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");
  const paymentCursor = url.searchParams.get("cursor");

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

  const data = await getBillingData({
    tenantId: ctx.tenant.id,
    startDate: startDate ?? undefined,
    endDate: endDate ?? undefined,
    paymentCursor: paymentCursor ?? undefined,
    includePayments: !!includePayments,
  });

  return Response.json({
    success: true,
    data,
  });
}

async function postHandler(req: Request, ctx: RequestContext) {
  const body = await req.json();
  const { action } = body;

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

    const plan = await core.getPlanById(planId);
    if (!plan) {
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

    const planOpMap = plan.maxOperationCount ?? {};
    const operationCountMap = Object.keys(planOpMap).length > 0
      ? Object.fromEntries(
        Object.entries(planOpMap).filter(([, v]) => v > 0),
      )
      : null;

    const userId = ctx.tenant.actorId ?? null;
    const now = new Date();
    const periodEnd = new Date(
      now.getTime() + (plan.recurrenceDays ?? 30) * 86400000,
    );

    const result = await subscribe({
      tenantId: ctx.tenant.id,
      companyId,
      systemId,
      planId,
      paymentMethodId: paymentMethodId ?? null,
      userId,
      planCredits: plan.planCredits ?? 0,
      operationCountMap,
      start: now,
      end: periodEnd,
    });

    await Core.getInstance().reloadSubscription(ctx.tenant.id);

    return Response.json({ success: true, data: result }, { status: 201 });
  }

  if (action === "cancel") {
    const guard = tenantGuard(ctx);
    if (guard) return guard;

    await cancelSubscription(ctx.tenant.id);

    await Core.getInstance().reloadSubscription(ctx.tenant.id);

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

    const pm = await addPaymentMethod({
      tenantId: ctx.tenant.id,
      cardToken,
      cardMask,
      holderName,
      holderDocument,
      billingAddress,
    });

    return Response.json(
      { success: true, data: pm },
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

    await setDefaultPaymentMethod(ctx.tenant.id, paymentMethodId);

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

    await removePaymentMethod(paymentMethodId);

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

    const { purchase, activeSubscriptionId } = await purchaseCredits({
      tenantId: ctx.tenant.id,
      amount: Number(amount),
      paymentMethodId,
    });

    await publish("process_payment", {
      creditPurchaseId: String(purchase?.id ?? ""),
      subscriptionId: activeSubscriptionId,
      tenantId: ctx.tenant.id,
      amount: String(amount),
      purpose: "credits",
    });

    await Core.getInstance().reloadSubscription(ctx.tenant.id);

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

    const { voucher, subscription: activeSub, oldVoucher } =
      await lookupVoucherAndSubscription({
        voucherCode,
        tenantId: ctx.tenant.id,
      });

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

    const applicableIds = voucher.applicableTenantIds as string[];
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
    const currentPlanId = String(activeSub?.planId ?? "");
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

    const oldCreditMod = Number(oldVoucher?.creditModifier ?? 0);
    const newCreditMod = Number(voucher.creditModifier ?? 0);
    const creditDelta = newCreditMod - oldCreditMod;

    // Per-resourceKey operation count delta
    const oldOpCountMod = oldVoucher?.maxOperationCountModifier ?? {};
    const newOpCountMod = (voucher.maxOperationCountModifier ?? {}) as Record<
      string,
      number
    >;
    const allOpKeys = new Set([
      ...Object.keys(oldOpCountMod),
      ...Object.keys(newOpCountMod),
    ]);
    const opCountDeltas: Record<string, number> = {};
    for (const key of allOpKeys) {
      const delta = (newOpCountMod[key] ?? 0) - (oldOpCountMod[key] ?? 0);
      if (delta !== 0) opCountDeltas[key] = delta;
    }

    const opCountNewValues: Record<string, number> = {};
    const alertResets: Record<string, boolean> = {};
    const currentOpCounts = activeSub?.remainingOperationCount ?? {};
    for (const key of allOpKeys) {
      const current = currentOpCounts[key] ?? 0;
      const delta = opCountDeltas[key] ?? 0;
      const newVal = Math.max(0, current + delta);
      opCountNewValues[key] = newVal;
      if (delta > 0 && newVal > 0) {
        alertResets[key] = false;
      }
    }

    await applyVoucherToSubscription({
      tenantId: ctx.tenant.id,
      voucherId: voucher.id as string,
      creditDelta,
      opCountNewValues,
      alertResets,
    });

    await Core.getInstance().reloadSubscription(ctx.tenant.id);

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
          { systemId: ctx.tenant.systemId, companyId: ctx.tenant.companyId },
        )) ?? "500",
      );
      const maxAmount = Number(
        (await core.getSetting(
          "billing.autoRecharge.maxAmount",
          { systemId: ctx.tenant.systemId, companyId: ctx.tenant.companyId },
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

      const { hasDefaultPaymentMethod } = await enableAutoRecharge({
        tenantId: ctx.tenant.id,
        amount: Number(amount),
      });

      if (!hasDefaultPaymentMethod) {
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
      await disableAutoRecharge(ctx.tenant.id);
    }

    await Core.getInstance().reloadSubscription(ctx.tenant.id);

    return Response.json({ success: true });
  }

  if (action === "retry_payment") {
    const guard = tenantGuard(ctx);
    if (guard) return guard;

    const result = await retryPayment(ctx.tenant.id);

    if (result.status === "not_found") {
      return Response.json(
        {
          success: false,
          error: { code: "NOT_FOUND", message: "billing.retry.noPastDue" },
        },
        { status: 404 },
      );
    }

    if (result.status === "conflict") {
      return Response.json(
        {
          success: false,
          error: { code: "CONFLICT", message: "billing.retry.inProgress" },
        },
        { status: 409 },
      );
    }

    await publish("process_payment", {
      subscriptionId: result.subscriptionId!,
      tenantId: ctx.tenant.id,
      purpose: "retry",
    });

    await Core.getInstance().reloadSubscription(ctx.tenant.id);

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
