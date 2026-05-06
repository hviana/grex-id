import { compose } from "@/server/middleware/compose";

import { withAuthAndLimit } from "@/server/middleware/withAuthAndLimit";
import type { RequestContext } from "@/src/contracts/high-level/tenant-context";
import { publish } from "@/server/event-queue/publisher";
import type { ResourceLimit } from "@/src/contracts/resource-limit";
import { parseBody } from "@/server/utils/parse-body";
import { get, updateTenantCache } from "@/server/utils/cache";
import {
  addPaymentMethod,
  applyVoucherToSubscription,
  cancelSubscription,
  disableAutoRecharge,
  enableAutoRecharge,
  ensureCompanySystemTenant,
  getBillingData,
  lookupVoucherAndSubscription,
  purchaseCredits,
  removePaymentMethod,
  retryPayment,
  setDefaultPaymentMethod,
  subscribe,
  validateVoucher,
} from "@/server/db/queries/billing";
import { genericList } from "@/server/db/queries/generics";

function tenantGuard(ctx: RequestContext): Response | null {
  if (
    !ctx.tenantContext.tenant.companyId || !ctx.tenantContext.tenant.systemId
  ) {
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

  const csTenantId = await ensureCompanySystemTenant({
    companyId: ctx.tenantContext.tenant.companyId!,
    systemId: ctx.tenantContext.tenant.systemId!,
  });

  const data = await getBillingData({
    tenantId: csTenantId,
    startDate: startDate ?? undefined,
    endDate: endDate ?? undefined,
    paymentCursor: paymentCursor ?? undefined,
    includePayments: !!includePayments,
  });

  // Resolve the active subscription's voucher resource limits via genericList
  // cascade so PlanCard can merge plan + voucher limits with full sub-entities.
  const subscriptions = (data.subscriptions ?? []) as Record<string, unknown>[];
  const activeSub = subscriptions.find((s) => s.status === "active");
  const activeVoucher = activeSub?.voucherId;

  if (activeVoucher && typeof activeVoucher === "object") {
    const vid = String((activeVoucher as Record<string, unknown>).id);
    const result = await genericList<Record<string, unknown>>({
      table: "voucher",
      select:
        "id, name, priceModifier, applicablePlanIds, expiresAt, resourceLimitId, applicableTenantIds, createdAt",
      extraConditions: [
        `id = type::record("voucher", "${vid.split(":")[1]}")`,
      ],
      extraBindings: {},
      extraAccessFields: ["id"],
      allowRawExtraConditions: true,
      limit: 1,
      cascade: [{
        table: "resource_limit",
        sourceField: "resourceLimitId",
        select:
          "id, roleIds, benefits, entityLimits, apiRateLimit, storageLimitBytes, fileCacheLimitBytes, credits, maxConcurrentDownloads, maxConcurrentUploads, maxDownloadBandwidthMB, maxUploadBandwidthMB, maxOperationCountByResourceKey, creditLimitByResourceKey, frontendDomains, priceModifier",
        children: [{
          table: "role",
          sourceField: "roleIds",
          isArray: true,
          select: "id, name",
        }],
      }],
    });
    const enriched = result?.items?.[0];
    if (enriched) {
      const cascadeRl = (enriched as Record<string, unknown>)._cascade as
        | Record<string, unknown>
        | undefined;
      if (cascadeRl?.resourceLimitId) {
        (enriched as Record<string, unknown>).resourceLimitId =
          cascadeRl.resourceLimitId;
      }
      activeSub.voucherId = enriched;
    }
  }

  return Response.json({
    success: true,
    data,
  });
}

async function postHandler(req: Request, ctx: RequestContext) {
  const { body, error } = await parseBody(req);
  if (error) return error;
  const { action } = body;

  // §9.2: companyId/systemId come from ctx.tenant, except subscribe which
  // accepts them from body for the onboarding flow (user hasn't exchanged yet)
  const companyId = action === "subscribe" && body.companyId
    ? body.companyId
    : ctx.tenantContext.tenant.companyId;
  const systemId = action === "subscribe" && body.systemId
    ? body.systemId
    : ctx.tenantContext.tenant.systemId;

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

    const coreData = await get(undefined, "core-data") as any;
    const coreSystem = coreData.systemsBySlug?.core;
    if (coreSystem && systemId === coreSystem.id) {
      return Response.json(
        {
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "validation.system.coreNotAvailable",
          },
        },
        { status: 403 },
      );
    }

    const plan = coreData.plansById[planId];
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

    const rl = (plan.resourceLimitId ?? {}) as unknown as ResourceLimit;
    const planOpMap = rl.maxOperationCountByResourceKey ?? {};
    const operationCountMap = Object.keys(planOpMap).length > 0
      ? Object.fromEntries(
        Object.entries(planOpMap).filter(([, v]) => v > 0),
      )
      : null;

    const userId = ctx.tenantContext.tenant.actorId ?? null;
    const now = new Date();
    const periodEnd = new Date(
      now.getTime() + (plan.recurrenceDays ?? 30) * 86400000,
    );

    const tenantId = await ensureCompanySystemTenant({ companyId, systemId });
    if (!tenantId) {
      return Response.json(
        {
          success: false,
          error: { code: "SERVER_ERROR", message: "common.error.generic" },
        },
        { status: 500 },
      );
    }

    const result = await subscribe({
      tenantId,
      companyId,
      systemId,
      planId,
      paymentMethodId: paymentMethodId ?? null,
      userId,
      planCredits: rl.credits ?? 0,
      operationCountMap,
      start: now,
      end: periodEnd,
    });

    if (body.voucherName) {
      const voucher = await validateVoucher({
        voucherName: body.voucherName,
        planId,
      });
      if (voucher && voucher.id) {
        const vRl = (voucher.resourceLimitId ?? {}) as Record<string, unknown>;
        const creditDelta = Number(vRl.credits ?? 0);
        const vOpCount = (vRl.maxOperationCountByResourceKey ?? {}) as Record<
          string,
          number
        >;
        const opCountNewValues: Record<string, number> = {};
        const alertResets: Record<string, boolean> = {};
        for (const key of Object.keys(vOpCount)) {
          const base = operationCountMap?.[key] ?? 0;
          opCountNewValues[key] = Math.max(0, base + (vOpCount[key] ?? 0));
          alertResets[key] = false;
        }
        await applyVoucherToSubscription({
          tenantId,
          voucherId: voucher.id as string,
          creditDelta,
          opCountNewValues: Object.keys(opCountNewValues).length > 0
            ? opCountNewValues
            : undefined,
          alertResets: Object.keys(alertResets).length > 0
            ? alertResets
            : undefined,
        });
      }
    }

    updateTenantCache({ systemId, companyId }, "subscription");
    updateTenantCache({ systemId, companyId }, "limits");
    if (userId) {
      updateTenantCache({ systemId, companyId, actorId: userId }, "roles");
      updateTenantCache({ systemId, companyId, actorId: userId }, "limits");
    }

    return Response.json({ success: true, data: result }, { status: 201 });
  }

  if (action === "cancel") {
    const guard = tenantGuard(ctx);
    if (guard) return guard;

    const csTenantId = await ensureCompanySystemTenant({ companyId, systemId });
    await cancelSubscription(csTenantId);

    updateTenantCache(
      {
        systemId: ctx.tenantContext.tenant.systemId,
        companyId: ctx.tenantContext.tenant.companyId,
      },
      "subscription",
    );
    updateTenantCache(
      {
        systemId: ctx.tenantContext.tenant.systemId,
        companyId: ctx.tenantContext.tenant.companyId,
      },
      "limits",
    );

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

    const csTenantId = await ensureCompanySystemTenant({ companyId, systemId });
    const pm = await addPaymentMethod({
      tenantId: csTenantId,
      cardData: { cardToken, cardMask, holderName, holderDocument },
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

    const csTenantId = await ensureCompanySystemTenant({ companyId, systemId });
    await setDefaultPaymentMethod(
      csTenantId,
      paymentMethodId,
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

    const csTenantId = await ensureCompanySystemTenant({ companyId, systemId });
    const { purchase, activeSubscriptionId } = await purchaseCredits({
      tenantId: csTenantId,
      amount: Number(amount),
      paymentMethodId,
    });

    await publish("process_payment", {
      creditPurchaseId: String(purchase?.id ?? ""),
      subscriptionId: activeSubscriptionId,
      tenantId: csTenantId,
      amount: String(amount),
      purpose: "credits",
    });

    updateTenantCache(
      {
        systemId: ctx.tenantContext.tenant.systemId,
        companyId: ctx.tenantContext.tenant.companyId,
      },
      "subscription",
    );

    return Response.json(
      { success: true, data: purchase },
      { status: 201 },
    );
  }

  if (action === "apply_voucher") {
    const { voucherName } = body;

    if (!voucherName) {
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

    const csTenantId = await ensureCompanySystemTenant({ companyId, systemId });
    const { voucher, subscription: activeSub, oldVoucher } =
      await lookupVoucherAndSubscription({
        voucherName,
        tenantId: csTenantId,
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

    const oldRl = (oldVoucher?.resourceLimitId ?? {}) as Record<
      string,
      unknown
    >;
    const newRl = (voucher.resourceLimitId ?? {}) as Record<string, unknown>;
    const oldCreditMod = Number(oldRl.credits ?? 0);
    const newCreditMod = Number(newRl.credits ?? 0);
    const creditDelta = newCreditMod - oldCreditMod;

    // Per-resourceKey operation count delta
    const oldOpCountMod =
      (oldRl.maxOperationCountByResourceKey ?? {}) as Record<string, number>;
    const newOpCountMod =
      (newRl.maxOperationCountByResourceKey ?? {}) as Record<string, number>;
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
      tenantId: csTenantId,
      voucherId: voucher.id as string,
      creditDelta,
      opCountNewValues,
      alertResets,
    });

    updateTenantCache(
      {
        systemId: ctx.tenantContext.tenant.systemId,
        companyId: ctx.tenantContext.tenant.companyId,
      },
      "subscription",
    );
    updateTenantCache(
      {
        systemId: ctx.tenantContext.tenant.systemId,
        companyId: ctx.tenantContext.tenant.companyId,
      },
      "limits",
    );

    return Response.json({
      success: true,
      data: voucher,
      message: "billing.voucher.success",
    });
  }

  if (action === "validate_voucher") {
    const { voucherName, planId } = body;

    if (!voucherName) {
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

    const voucher = await validateVoucher({
      voucherName,
      planId,
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

    // Check plan applicability if planId provided
    const applicablePlanIds = voucher.applicablePlanIds as string[];
    if (applicablePlanIds && applicablePlanIds.length > 0 && planId) {
      if (!applicablePlanIds.some((id) => String(id) === String(planId))) {
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

    return Response.json({
      success: true,
      data: voucher,
    });
  }

  if (action === "set_auto_recharge") {
    const { enabled, amount } = body;

    const guard = tenantGuard(ctx);
    if (guard) return guard;

    const csTenantId = await ensureCompanySystemTenant({ companyId, systemId });

    if (enabled) {
      const autoRechargeSettingScope = {
        systemId: ctx.tenantContext.tenant.systemId!,
        companyId: ctx.tenantContext.tenant.companyId!,
      };
      const minAmount = Number(
        (await get(
          autoRechargeSettingScope,
          "setting.billing.autoRecharge.minAmount",
        )) ?? "500",
      );
      const maxAmount = Number(
        (await get(
          autoRechargeSettingScope,
          "setting.billing.autoRecharge.maxAmount",
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
        tenantId: csTenantId,
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
      await disableAutoRecharge(csTenantId);
    }

    updateTenantCache(
      {
        systemId: ctx.tenantContext.tenant.systemId,
        companyId: ctx.tenantContext.tenant.companyId,
      },
      "subscription",
    );

    return Response.json({ success: true });
  }

  if (action === "retry_payment") {
    const guard = tenantGuard(ctx);
    if (guard) return guard;

    const csTenantId = await ensureCompanySystemTenant({ companyId, systemId });
    const result = await retryPayment(csTenantId);

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
      tenantId: csTenantId,
      purpose: "retry",
    });

    updateTenantCache(
      {
        systemId: ctx.tenantContext.tenant.systemId,
        companyId: ctx.tenantContext.tenant.companyId,
      },
      "subscription",
    );

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
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
  }),
  async (req, ctx) => getHandler(req, ctx),
);

export const POST = compose(
  withAuthAndLimit({
    rateLimit: { windowMs: 60_000, maxRequests: 60 },
  }),
  async (req, ctx) => postHandler(req, ctx),
);
