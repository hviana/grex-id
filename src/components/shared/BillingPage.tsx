"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CursorParams,
  PaginatedResult,
} from "@/src/contracts/high-level/pagination";
import type { PaymentMethodSubformRef } from "@/src/components/subforms/PaymentMethodSubform";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import Modal from "@/src/components/shared/Modal";
import GenericList from "@/src/components/shared/GenericList";
import DateRangeFilter from "@/src/components/filters/DateRangeFilter";
import PlanCard, { formatPrice } from "@/src/components/shared/PlanCard";
import { mergeResourceLimits } from "@/src/lib/merge-resource-limits";
import type { ResourceLimitsData } from "@/src/contracts/high-level/resource-limits";
import DateView from "@/src/components/shared/DateView";
import PaymentMethodSubform from "@/src/components/subforms/PaymentMethodSubform";
import type {
  CreditPurchaseView,
  PaymentMethodView,
  PaymentRecordView,
  PlanView,
  SubscriptionView,
  VoucherPreview,
  VoucherView,
} from "@/src/contracts/high-level/billing-display";
import { useTenantContext } from "@/src/hooks/useTenantContext";
import GenericFormButton from "@/src/components/shared/GenericFormButton";
import DeleteButton from "@/src/components/shared/DeleteButton";

const inputCls =
  "w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors";

export default function BillingPage() {
  const { t } = useTenantContext();
  const { systemToken, companyId, systemId, systemSlug } = useTenantContext();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subscriptions, setSubscriptions] = useState<SubscriptionView[]>([]);
  const [plans, setPlans] = useState<PlanView[]>([]);
  const [planMap, setPlanMap] = useState<Record<string, PlanView>>({});
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodView[]>([]);
  const [creditPurchases, setCreditPurchases] = useState<
    CreditPurchaseView[]
  >([]);
  const [creditsBalance, setCreditsBalance] = useState(0);
  const [pendingAsyncPayments, setPendingAsyncPayments] = useState<
    PaymentRecordView[]
  >([]);

  const [subscribing, setSubscribing] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [settingDefault, setSettingDefault] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const [showPmModal, setShowPmModal] = useState(false);
  const [addingPm, setAddingPm] = useState(false);
  const [pmError, setPmError] = useState<string | null>(null);
  const pmRef = useRef<PaymentMethodSubformRef>(null);

  const [purchasingCredits, setPurchasingCredits] = useState(false);
  const [creditAmount, setCreditAmount] = useState("");
  const [creditPmId, setCreditPmId] = useState("");

  const [applyingVoucher, setApplyingVoucher] = useState(false);
  const [voucherName, setVoucherName] = useState("");
  const [voucherError, setVoucherError] = useState<string | null>(null);
  const [voucherSuccess, setVoucherSuccess] = useState<string | null>(null);

  const [autoRechargeEnabled, setAutoRechargeEnabled] = useState(false);
  const [autoRechargeAmount, setAutoRechargeAmount] = useState("");
  const [savingAutoRecharge, setSavingAutoRecharge] = useState(false);

  // Derived values
  const activeSub = subscriptions.find((s) => s.status === "active");
  const pastDueSub = subscriptions.find((s) => s.status === "past_due");
  const displaySub = activeSub ?? pastDueSub;
  const activePlan = displaySub ? planMap[displaySub.planId] : null;

  const activeVoucher: VoucherView | null = activeSub?.voucherId &&
      typeof activeSub.voucherId === "object" &&
      (!activeSub.voucherId.expiresAt ||
        new Date(activeSub.voucherId.expiresAt) > new Date())
    ? activeSub.voucherId
    : null;

  const voucherPreview: VoucherPreview | null = activeVoucher
    ? {
      id: activeVoucher.id,
      name: activeVoucher.name,
      priceModifier: activeVoucher.priceModifier,
      resourceLimitId: activeVoucher.resourceLimitId,
      expiresAt: activeVoucher.expiresAt,
    }
    : null;

  const sortedPaymentMethods = useMemo(
    () =>
      [...paymentMethods].sort((a, b) => {
        if (a.isDefault && !b.isDefault) return -1;
        if (!a.isDefault && b.isDefault) return 1;
        return 0;
      }),
    [paymentMethods],
  );

  // GenericList fetch wrappers for local data
  const fetchPaymentMethodsList = useCallback(
    async (): Promise<PaginatedResult<PaymentMethodView>> => ({
      items: sortedPaymentMethods,
      total: sortedPaymentMethods.length,
      hasMore: false,
    }),
    [sortedPaymentMethods],
  );

  const fetchPendingPayments = useCallback(
    async (): Promise<PaginatedResult<PaymentRecordView>> => ({
      items: pendingAsyncPayments,
      total: pendingAsyncPayments.length,
      hasMore: false,
    }),
    [pendingAsyncPayments],
  );

  const fetchCreditPurchasesList = useCallback(
    async (): Promise<PaginatedResult<CreditPurchaseView>> => ({
      items: creditPurchases,
      total: creditPurchases.length,
      hasMore: false,
    }),
    [creditPurchases],
  );

  const fetchPaymentHistory = useCallback(
    async (
      params: CursorParams & {
        search?: string;
        filters?: Record<string, unknown>;
      },
    ): Promise<PaginatedResult<PaymentRecordView>> => {
      if (!companyId || !systemId || !systemToken) {
        return { items: [], total: 0, hasMore: false };
      }
      const p = new URLSearchParams();
      p.set("include", "payments");
      if (params.filters?.dateRange) {
        const [start, end] = params.filters.dateRange as [Date, Date];
        if (start) p.set("startDate", start.toISOString().slice(0, 10));
        if (end) p.set("endDate", end.toISOString().slice(0, 10));
      }
      if (params.cursor) p.set("cursor", params.cursor);
      p.set("limit", String(params.limit));
      const res = await fetch(`/api/billing?${p}`, {
        headers: { Authorization: `Bearer ${systemToken}` },
      });
      const json = await res.json();
      return {
        items: (json.data?.payments ?? []) as PaymentRecordView[],
        total: 0,
        hasMore: !!json.data?.paymentsNextCursor,
        nextCursor: json.data?.paymentsNextCursor,
      };
    },
    [systemToken, companyId, systemId],
  );

  const loadData = useCallback(
    async (silent?: boolean) => {
      if (!companyId || !systemId || !systemToken) return;
      if (!silent) setLoading(true);
      if (!silent) setError(null);

      try {
        const [billingRes, plansRes] = await Promise.all([
          fetch(`/api/billing`, {
            headers: { Authorization: `Bearer ${systemToken}` },
          }),
          fetch(
            `/api/core/plans?systemId=${encodeURIComponent(systemId)}&limit=50`,
            { headers: { Authorization: `Bearer ${systemToken}` } },
          ),
        ]);

        const billingJson = await billingRes.json();
        const plansJson = await plansRes.json();

        if (billingJson.success) {
          setSubscriptions(billingJson.data?.subscriptions ?? []);
          setPaymentMethods(billingJson.data?.paymentMethods ?? []);
          setCreditPurchases(billingJson.data?.creditPurchases ?? []);
          setCreditsBalance(billingJson.data?.creditsBalance ?? 0);
          setPendingAsyncPayments(
            billingJson.data?.pendingAsyncPayments ?? [],
          );
        }

        const allPlans: PlanView[] = (plansJson.items ?? []).filter(
          (p: PlanView) => p.isActive,
        );
        setPlans(allPlans);

        const map: Record<string, PlanView> = {};
        for (const p of allPlans) map[p.id] = p;
        setPlanMap(map);
      } catch {
        if (!silent) setError("common.error.network");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [companyId, systemId, systemToken],
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (pendingAsyncPayments.length === 0) return;
    const interval = setInterval(() => loadData(true), 30000);
    return () => clearInterval(interval);
  }, [pendingAsyncPayments.length, loadData]);

  useEffect(() => {
    const sub = subscriptions.find((s) => s.status === "active");
    if (sub) {
      setAutoRechargeEnabled(sub.autoRechargeEnabled ?? false);
      setAutoRechargeAmount(
        sub.autoRechargeAmount ? String(sub.autoRechargeAmount) : "",
      );
    } else {
      setAutoRechargeEnabled(false);
      setAutoRechargeAmount("");
    }
  }, [subscriptions]);

  const billingPost = async (body: Record<string, unknown>) => {
    if (!systemToken) throw new Error("No token");
    const res = await fetch("/api/billing", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${systemToken}`,
      },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!json.success) {
      throw new Error(json.error?.message ?? "common.error.generic");
    }
    return json;
  };

  const handleSubscribe = async (planId: string) => {
    if (!companyId || !systemId || !systemToken) return;
    const plan = planMap[planId];
    if (plan?.price > 0 && paymentMethods.length === 0) {
      setError("billing.paymentMethods.required");
      return;
    }
    setSubscribing(planId);
    setError(null);
    try {
      const defaultPm = paymentMethods.find((pm) => pm.isDefault);
      await billingPost({
        action: "subscribe",
        planId,
        paymentMethodId: plan?.price > 0 ? defaultPm?.id : undefined,
      });
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "common.error.generic");
    } finally {
      setSubscribing(null);
    }
  };

  const handleCancel = async () => {
    if (!companyId || !systemId || !systemToken) return;
    setCancelling(true);
    setError(null);
    try {
      await billingPost({ action: "cancel" });
      setCancelModalOpen(false);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "common.error.generic");
    } finally {
      setCancelling(false);
    }
  };

  const handleSetDefault = async (pmId: string) => {
    if (!companyId || !systemToken) return;
    setSettingDefault(pmId);
    try {
      await billingPost({
        action: "set_default_payment_method",
        paymentMethodId: pmId,
      });
      await loadData();
    } catch {
      setError("common.error.network");
    } finally {
      setSettingDefault(null);
    }
  };

  const handleRemovePm = async (pmId: string) => {
    if (!systemToken) return;
    try {
      await billingPost({
        action: "remove_payment_method",
        paymentMethodId: pmId,
      });
      await loadData();
    } catch {
      setError("common.error.network");
    }
  };

  const handleAddPaymentMethod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pmRef.current?.isValid() || !systemToken) return;

    setAddingPm(true);
    setPmError(null);

    try {
      const {
        cardToken,
        cardMask,
        holderName,
        holderDocument,
        billingAddress,
      } = await pmRef.current.submitData();

      await billingPost({
        action: "add_payment_method",
        cardToken,
        cardMask,
        holderName,
        holderDocument,
        billingAddress,
      });

      setShowPmModal(false);
      await loadData();
    } catch (e) {
      setPmError(e instanceof Error ? e.message : "common.error.generic");
    } finally {
      setAddingPm(false);
    }
  };

  const handleApplyVoucher = async () => {
    if (!companyId || !systemId || !systemToken || !voucherName.trim()) return;
    setApplyingVoucher(true);
    setVoucherError(null);
    setVoucherSuccess(null);
    try {
      await billingPost({
        action: "apply_voucher",
        voucherName: voucherName.trim(),
      });
      setVoucherSuccess("billing.voucher.success");
      setVoucherName("");
      await loadData();
    } catch (e) {
      setVoucherError(e instanceof Error ? e.message : "common.error.generic");
    } finally {
      setApplyingVoucher(false);
    }
  };

  const handlePurchaseCredits = async () => {
    if (
      !companyId || !systemId || !systemToken || !creditAmount || !creditPmId
    ) return;
    setPurchasingCredits(true);
    setError(null);
    try {
      await billingPost({
        action: "purchase_credits",
        amount: Number(creditAmount),
        paymentMethodId: creditPmId,
      });
      setCreditAmount("");
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "common.error.generic");
    } finally {
      setPurchasingCredits(false);
    }
  };

  const handleSaveAutoRecharge = async () => {
    if (!companyId || !systemId || !systemToken) return;
    setSavingAutoRecharge(true);
    setError(null);
    try {
      await billingPost({
        action: "set_auto_recharge",
        enabled: autoRechargeEnabled,
        amount: autoRechargeEnabled ? Number(autoRechargeAmount) : 0,
      });
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "common.error.generic");
    } finally {
      setSavingAutoRecharge(false);
    }
  };

  const handleRetryPayment = async () => {
    if (!companyId || !systemId || !systemToken) return;
    setRetrying(true);
    setError(null);
    try {
      await billingPost({ action: "retry_payment" });
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "common.error.generic");
    } finally {
      setRetrying(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
        {t("billing.title")}
      </h1>

      <ErrorDisplay message={error} />

      {/* Pending Async Payments */}
      {pendingAsyncPayments.length > 0 && (
        <div className="backdrop-blur-md bg-white/5 border border-dashed border-yellow-500/40 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-yellow-400 mb-4">
            {t("billing.pendingPayments.title")}
          </h2>
          <GenericList<PaymentRecordView>
            entityName={t("billing.pendingPayments.title")}
            searchEnabled={false}
            createEnabled={false}
            controlButtons={[]}
            fetchFn={fetchPendingPayments}
            reloadKey={pendingAsyncPayments.length}
            renderItem={(p) => {
              const cd = (p.continuityData ?? {}) as Record<string, string>;
              return (
                <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-3">
                      <span className="text-white font-medium">
                        {formatPrice(p.amount as number, p.currency as string)}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-xs bg-yellow-500/20 text-yellow-400">
                        {t("billing.pendingPayments.awaiting")}
                      </span>
                      <span className="text-xs text-[var(--color-light-text)]">
                        {t("billing.paymentHistory.kind." + p.kind)}
                      </span>
                    </div>
                    {p.expiresAt && (
                      <span className="text-xs text-orange-400">
                        {t("billing.pendingPayments.expiresAt")}:{" "}
                        <DateView
                          mode="datetime"
                          value={p.expiresAt as string}
                          className="text-xs text-orange-400"
                        />
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {cd.qrCodeUrl && (
                      <div className="flex flex-col items-center gap-1">
                        <img
                          src={cd.qrCodeUrl}
                          alt="QR Code"
                          className="w-32 h-32 rounded-lg border border-dashed border-[var(--color-dark-gray)]"
                        />
                        <span className="text-xs text-[var(--color-light-text)]">
                          {t("billing.pendingPayments.scanQrCode")}
                        </span>
                      </div>
                    )}
                    {cd.paymentLink && (
                      <a
                        href={cd.paymentLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block px-4 py-2 rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] text-black font-semibold text-sm hover:-translate-y-0.5 transition-transform"
                      >
                        {t("billing.pendingPayments.payNow")}
                      </a>
                    )}
                    {cd.barCode && (
                      <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-lg p-3">
                        <span className="text-xs text-[var(--color-light-text)] block mb-1">
                          {t("billing.pendingPayments.copyCode")}
                        </span>
                        <span className="font-mono text-sm text-white break-all">
                          {cd.barCode}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            }}
          />
        </div>
      )}

      {/* Current Plan */}
      <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">
          {t("billing.plans.current")}
        </h2>
        {displaySub && activePlan
          ? (
            <div>
              {pastDueSub && (
                <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/30 p-4">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs ${
                          pastDueSub.retryPaymentInProgress
                            ? "bg-yellow-500/20 text-yellow-400"
                            : "bg-red-500/20 text-red-400"
                        }`}
                      >
                        {pastDueSub.retryPaymentInProgress
                          ? t("billing.paymentStatus.processing")
                          : t("billing.paymentStatus.pastDue")}
                      </span>
                      <span className="text-sm text-red-400">
                        {t("billing.paymentStatus.pastDueDescription")}
                      </span>
                    </div>
                    <button
                      onClick={handleRetryPayment}
                      disabled={retrying || pastDueSub.retryPaymentInProgress}
                      className="rounded-lg border border-red-500/50 px-4 py-2 text-red-400 hover:bg-red-500/10 transition-colors text-sm flex items-center gap-2 disabled:opacity-50"
                    >
                      {retrying && <Spinner size="sm" />}
                      {t("billing.paymentStatus.retry")}
                    </button>
                  </div>
                </div>
              )}

              <PlanCard
                plan={activePlan}
                variant="billing"
                voucher={voucherPreview}
                systemSlug={systemSlug ?? undefined}
                badges={
                  <span className="text-xs bg-[var(--color-primary-green)]/20 text-[var(--color-primary-green)] px-2 py-1 rounded-full">
                    {t("billing.plans.current")}
                  </span>
                }
              />

              <p className="text-sm text-[var(--color-light-text)] mt-4 mb-4">
                {t("billing.plans.nextBilling")}:{" "}
                <DateView
                  mode="date"
                  value={displaySub.currentPeriodEnd}
                  className="text-sm text-[var(--color-light-text)]"
                />
              </p>

              <button
                onClick={() => setCancelModalOpen(true)}
                className="rounded-lg border border-red-500/50 px-4 py-2 text-red-400 hover:bg-red-500/10 transition-colors text-sm"
              >
                {t("billing.plans.cancel")}
              </button>
            </div>
          )
          : (
            <p className="text-[var(--color-light-text)]">
              {t("billing.plans.noPlan")}
            </p>
          )}
      </div>

      {/* Available Plans */}
      <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">
          {t("billing.plans.title")}
        </h2>
        {plans.length === 0
          ? (
            <p className="text-[var(--color-light-text)]">
              {t("billing.onboarding.plan.empty")}
            </p>
          )
          : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {plans
                .filter((plan) => plan.id !== activeSub?.planId)
                .map((plan) => (
                  <PlanCard
                    key={plan.id}
                    plan={plan}
                    variant="billing"
                    systemSlug={systemSlug ?? undefined}
                    actions={
                      <button
                        onClick={() => handleSubscribe(plan.id)}
                        disabled={subscribing === plan.id}
                        className="w-full rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-4 py-2.5 font-semibold text-black transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {subscribing === plan.id && (
                          <Spinner
                            size="sm"
                            className="border-black border-t-transparent"
                          />
                        )}
                        {activeSub
                          ? t("billing.plans.changePlan")
                          : t("billing.plans.subscribe")}
                      </button>
                    }
                  />
                ))}
            </div>
          )}
      </div>

      {/* Payment Methods */}
      <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">
          {t("billing.paymentMethods.title")}
        </h2>
        <GenericList<PaymentMethodView>
          entityName={t("billing.paymentMethods.title")}
          searchEnabled={false}
          createEnabled={true}
          controlButtons={[]}
          onCreateClick={() => {
            setPmError(null);
            setShowPmModal(true);
          }}
          fetchFn={fetchPaymentMethodsList}
          reloadKey={paymentMethods.length}
          renderItem={(pm) => (
            <div className="flex items-center justify-between backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-lg p-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl">💳</span>
                <div>
                  <p className="text-white font-medium">{pm.cardMask}</p>
                  <p className="text-xs text-[var(--color-light-text)]">
                    {pm.holderName}
                  </p>
                </div>
                {pm.isDefault && (
                  <span className="text-xs bg-[var(--color-primary-green)]/20 text-[var(--color-primary-green)] px-2 py-0.5 rounded-full">
                    {t("billing.paymentMethods.default")}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                {!pm.isDefault && (
                  <button
                    onClick={() => handleSetDefault(pm.id)}
                    disabled={settingDefault === pm.id}
                    className="text-xs border border-[var(--color-dark-gray)] rounded px-2 py-1 text-[var(--color-light-text)] hover:bg-white/5 transition-colors flex items-center gap-1"
                  >
                    {settingDefault === pm.id && <Spinner size="sm" />}
                    {t("billing.paymentMethods.setDefault")}
                  </button>
                )}
                <DeleteButton onConfirm={() => handleRemovePm(pm.id)} />
              </div>
            </div>
          )}
        />
      </div>

      {/* Credits */}
      <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">
          {t("billing.credits.title")}
        </h2>
        <div className="flex items-center gap-4 mb-4">
          <span className="text-3xl">🪙</span>
          <div>
            <p className="text-sm text-[var(--color-light-text)]">
              {t("billing.credits.balance")}
            </p>
            <p className="text-2xl font-bold text-[var(--color-primary-green)]">
              {creditsBalance.toLocaleString()}
            </p>
          </div>
          {displaySub && (() => {
            const planBase = (
              (activePlan as Record<string, unknown>)?._cascade as
                | Record<string, unknown>
                | undefined
            )?.resourceLimitId as ResourceLimitsData | undefined;
            const merged = mergeResourceLimits(
              planBase ?? null,
              activeVoucher?.resourceLimitId ?? null,
            );
            const opCounts = merged?.maxOperationCountByResourceKey;
            if (
              opCounts && typeof opCounts === "object" &&
              Object.keys(opCounts).length > 0
            ) {
              return (
                <div className="ml-6 border-l border-[var(--color-dark-gray)] pl-6 space-y-2">
                  {Object.entries(opCounts).map(([key, cap]) => {
                    const remaining =
                      displaySub.remainingOperationCount?.[key] ?? 0;
                    return (
                      <div key={key}>
                        <p className="text-sm text-[var(--color-light-text)]">
                          🔢 {t("billing.limits." + key) !==
                              `billing.limits.${key}`
                            ? t("billing.limits." + key)
                            : key}
                        </p>
                        <p className="text-lg font-bold text-[var(--color-secondary-blue)]">
                          {cap <= 0
                            ? t("billing.limits.unlimited")
                            : `${remaining.toLocaleString()} / ${cap.toLocaleString()}`}
                        </p>
                      </div>
                    );
                  })}
                </div>
              );
            }
            return null;
          })()}
        </div>

        {sortedPaymentMethods.length > 0 && (
          <div className="border-t border-[var(--color-dark-gray)] pt-4 mb-4">
            <h3 className="text-sm font-semibold text-white mb-3">
              {t("billing.credits.purchase")}
            </h3>
            <div className="flex gap-3">
              <input
                type="number"
                min="1"
                value={creditAmount}
                onChange={(e) => setCreditAmount(e.target.value)}
                placeholder={t("billing.credits.amount")}
                className={`${inputCls} flex-1`}
              />
              <select
                value={creditPmId}
                onChange={(e) => setCreditPmId(e.target.value)}
                className={`${inputCls} flex-1`}
              >
                <option value="" className="bg-[var(--color-black)]">
                  {t("billing.credits.selectPayment")}
                </option>
                {sortedPaymentMethods.map((pm) => (
                  <option
                    key={pm.id}
                    value={pm.id}
                    className="bg-[var(--color-black)]"
                  >
                    {pm.cardMask}
                  </option>
                ))}
              </select>
              <button
                onClick={handlePurchaseCredits}
                disabled={purchasingCredits || !creditAmount || !creditPmId}
                className="rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-4 py-2 font-semibold text-black transition-all hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
              >
                {purchasingCredits && (
                  <Spinner
                    size="sm"
                    className="border-black border-t-transparent"
                  />
                )}
                {t("billing.credits.purchase")}
              </button>
            </div>
          </div>
        )}

        {creditPurchases.length > 0 && (
          <div className="border-t border-[var(--color-dark-gray)] pt-4">
            <h3 className="text-sm font-semibold text-white mb-3">
              {t("billing.credits.history")}
            </h3>
            <GenericList<CreditPurchaseView>
              entityName={t("billing.credits.history")}
              searchEnabled={false}
              createEnabled={false}
              controlButtons={[]}
              fetchFn={fetchCreditPurchasesList}
              reloadKey={creditPurchases.length}
              renderItem={(cp) => (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-white">
                    {(cp.amount as number).toLocaleString()}
                  </span>
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs ${
                        cp.status === "completed"
                          ? "bg-[var(--color-primary-green)]/20 text-[var(--color-primary-green)]"
                          : cp.status === "failed"
                          ? "bg-red-500/20 text-red-400"
                          : "bg-yellow-500/20 text-yellow-400"
                      }`}
                    >
                      {t("billing.credits.status." + cp.status)}
                    </span>
                    <span className="text-[var(--color-light-text)]">
                      <DateView
                        mode="datetime"
                        value={cp.createdAt as string}
                        className="text-[var(--color-light-text)]"
                      />
                    </span>
                  </div>
                </div>
              )}
            />
          </div>
        )}

        {activeSub && (
          <div className="border-t border-[var(--color-dark-gray)] pt-4 mt-4">
            <h3 className="text-sm font-semibold text-white mb-3">
              {t("billing.credits.autoRecharge.title")}
            </h3>
            <p className="text-sm text-[var(--color-light-text)] mb-3">
              {t("billing.credits.autoRecharge.description")}
            </p>
            {!sortedPaymentMethods.some((pm) => pm.isDefault)
              ? (
                <p className="text-sm text-yellow-400">
                  💡 {t("billing.credits.autoRecharge.noPaymentMethod")}
                </p>
              )
              : (
                <div className="space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoRechargeEnabled}
                      onChange={(e) => {
                        if (!e.target.checked) {
                          setAutoRechargeAmount("");
                        }
                        setAutoRechargeEnabled(e.target.checked);
                      }}
                      className="accent-[var(--color-primary-green)] w-4 h-4"
                    />
                    <span className="text-sm text-white">
                      {t("billing.credits.autoRecharge.title")}
                    </span>
                  </label>
                  {autoRechargeEnabled && (
                    <input
                      type="number"
                      min="500"
                      value={autoRechargeAmount}
                      onChange={(e) => setAutoRechargeAmount(e.target.value)}
                      placeholder={t(
                        "billing.credits.autoRecharge.amountLabel",
                      )}
                      className={inputCls}
                    />
                  )}
                  <button
                    onClick={handleSaveAutoRecharge}
                    disabled={savingAutoRecharge ||
                      (autoRechargeEnabled && !autoRechargeAmount) ||
                      (autoRechargeEnabled &&
                        Number(autoRechargeAmount) < 500)}
                    className="rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-4 py-2 font-semibold text-black transition-all hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
                  >
                    {savingAutoRecharge && (
                      <Spinner
                        size="sm"
                        className="border-black border-t-transparent"
                      />
                    )}
                    {t("common.save")}
                  </button>
                </div>
              )}
          </div>
        )}
      </div>

      {/* Voucher */}
      <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">
          {t("billing.voucher.title")}
        </h2>
        <div className="flex gap-3">
          <input
            type="text"
            value={voucherName}
            onChange={(e) => {
              setVoucherName(e.target.value);
              setVoucherError(null);
              setVoucherSuccess(null);
            }}
            placeholder={t("billing.voucher.name")}
            className={`${inputCls} flex-1`}
          />
          <button
            onClick={handleApplyVoucher}
            disabled={applyingVoucher || !voucherName.trim()}
            className="rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-4 py-2 font-semibold text-black transition-all hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
          >
            {applyingVoucher && (
              <Spinner
                size="sm"
                className="border-black border-t-transparent"
              />
            )}
            {t("billing.voucher.apply")}
          </button>
        </div>

        {voucherSuccess && (
          <div className="mt-3 rounded-lg bg-[var(--color-primary-green)]/10 border border-[var(--color-primary-green)]/30 p-3 text-sm text-[var(--color-primary-green)]">
            ✅ {t(voucherSuccess)}
          </div>
        )}
        {voucherError && (
          <div className="mt-3 rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">
            ❌ {t(voucherError)}
          </div>
        )}
      </div>

      {/* Payment History */}
      <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">
          {t("billing.paymentHistory.title")}
        </h2>
        <GenericList<PaymentRecordView>
          entityName={t("billing.paymentHistory.title")}
          searchEnabled={false}
          createEnabled={false}
          controlButtons={[]}
          filters={[{
            key: "dateRange",
            label: t("common.dateRange.title"),
            component: DateRangeFilter,
            props: { maxRangeDays: 365 },
          }]}
          fetchFn={fetchPaymentHistory}
          renderItem={(p) => (
            <div className="flex items-center justify-between backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-lg p-4 flex-wrap gap-2">
              <div className="flex items-center gap-4 flex-wrap">
                <span className="text-white font-medium">
                  {formatPrice(p.amount as number, p.currency as string)}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs ${
                    p.status === "completed"
                      ? "bg-[var(--color-primary-green)]/20 text-[var(--color-primary-green)]"
                      : p.status === "failed"
                      ? "bg-red-500/20 text-red-400"
                      : p.status === "expired"
                      ? "bg-orange-500/20 text-orange-400"
                      : "bg-yellow-500/20 text-yellow-400"
                  }`}
                >
                  {t("billing.paymentHistory.status." + p.status)}
                </span>
                <span className="text-xs text-[var(--color-light-text)]">
                  {t("billing.paymentHistory.kind." + p.kind)}
                </span>
                <span className="text-sm text-[var(--color-light-text)]">
                  <DateView
                    mode="datetime"
                    value={p.createdAt as string}
                    className="text-sm text-[var(--color-light-text)]"
                  />
                </span>
              </div>
              <div>
                {p.invoiceUrl
                  ? (
                    <a
                      href={p.invoiceUrl as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[var(--color-primary-green)] hover:underline"
                    >
                      {t("billing.paymentHistory.viewInvoice")}
                    </a>
                  )
                  : (
                    <span className="text-xs text-[var(--color-light-text)]">
                      {t("billing.paymentHistory.invoiceNotAvailable")}
                    </span>
                  )}
              </div>
            </div>
          )}
        />
      </div>

      {/* Cancel confirmation modal */}
      <Modal
        open={cancelModalOpen}
        onClose={() => setCancelModalOpen(false)}
        title={t("billing.plans.cancelConfirm")}
      >
        <div className="text-center space-y-4">
          <p className="text-lg text-white">
            {t("billing.plans.cancelConfirm")}
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => setCancelModalOpen(false)}
              className="rounded-lg border border-[var(--color-dark-gray)] px-4 py-2 text-[var(--color-light-text)] hover:bg-white/5 transition-colors"
            >
              {t("common.back")}
            </button>
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="rounded-lg bg-red-500/80 px-4 py-2 text-white font-semibold hover:bg-red-500 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {cancelling && <Spinner size="sm" />}
              {t("billing.plans.cancel")}
            </button>
          </div>
        </div>
      </Modal>

      {/* Add payment method modal */}
      <Modal
        open={showPmModal}
        onClose={() => {
          setShowPmModal(false);
          setPmError(null);
        }}
        title={t("billing.paymentMethods.add")}
      >
        <form onSubmit={handleAddPaymentMethod} className="space-y-4">
          <ErrorDisplay message={pmError} />
          <PaymentMethodSubform
            ref={pmRef}
            showDefaultToggle={paymentMethods.length > 0}
          />
          <GenericFormButton
            loading={addingPm}
            label={t("billing.paymentMethods.add")}
          />
        </form>
      </Modal>
    </div>
  );
}
