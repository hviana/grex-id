"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/src/hooks/useLocale";
import { useAuth } from "@/src/hooks/useAuth";
import { useSystemContext } from "@/src/hooks/useSystemContext";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import Modal from "@/src/components/shared/Modal";
import DateRangeFilter from "@/src/components/shared/DateRangeFilter";

interface VoucherInfo {
  id: string;
  code: string;
  priceModifier: number; // positive = surcharge (in cents), negative = discount
  creditIncrement: number;
  maxConcurrentDownloadsModifier?: number;
  maxConcurrentUploadsModifier?: number;
  maxDownloadBandwidthModifier?: number;
  maxUploadBandwidthModifier?: number;
  maxOperationCountModifier?: number;
  expiresAt?: string;
}

interface Subscription {
  id: string;
  planId: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  voucherId: VoucherInfo | null; // single voucher, fetched via FETCH
  remainingOperationCount: number; // operation count; 0 = unlimited
  autoRechargeEnabled: boolean;
  autoRechargeAmount: number; // cents; 0 when disabled
  retryPaymentInProgress: boolean;
}

interface PlanInfo {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  recurrenceDays: number;
  benefits: string[];
  permissions: string[];
  entityLimits?: Record<string, number>;
  apiRateLimit: number;
  storageLimitBytes: number;
  fileCacheLimitBytes?: number;
  planCredits?: number;
  maxConcurrentDownloads?: number;
  maxConcurrentUploads?: number;
  maxDownloadBandwidthMB?: number;
  maxUploadBandwidthMB?: number;
  maxOperationCount?: number;
  isActive: boolean;
}

interface PaymentMethodInfo {
  id: string;
  cardMask: string;
  holderName: string;
  isDefault: boolean;
  createdAt: string;
}

interface CreditPurchaseInfo {
  id: string;
  amount: number;
  status: string;
  createdAt: string;
}

interface PaymentRecord {
  id: string;
  amount: number;
  currency: string;
  kind: string;
  status: string;
  invoiceUrl?: string;
  continuityData?: Record<string, any>;
  expiresAt?: string;
  createdAt: string;
}

function PaymentHistoryList({
  systemToken,
  companyId,
  systemId,
  startDate,
  endDate,
  formatPrice,
  formatDate,
}: {
  systemToken: string | null;
  companyId: string;
  systemId: string;
  startDate?: Date;
  endDate?: Date;
  formatPrice: (price: number, currency: string) => string;
  formatDate: (dateStr: string) => string;
}) {
  const { t } = useLocale();
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();

  const loadPayments = useCallback(async (reset: boolean = false) => {
    if (!companyId || !systemId || !systemToken) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("include", "payments");
      if (startDate) {
        params.set("startDate", startDate.toISOString().slice(0, 10));
      }
      if (endDate) params.set("endDate", endDate.toISOString().slice(0, 10));
      if (!reset && cursor) params.set("cursor", cursor);
      const res = await fetch(`/api/billing?${params}`, {
        headers: { Authorization: `Bearer ${systemToken}` },
      });
      const json = await res.json();
      if (json.success) {
        const newPayments = (json.data?.payments ?? []) as PaymentRecord[];
        setPayments(reset ? newPayments : (prev) => [...prev, ...newPayments]);
        setNextCursor(json.data?.paymentsNextCursor ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, [companyId, systemId, systemToken, cursor, startDate, endDate]);

  useEffect(() => {
    setCursor(undefined);
    loadPayments(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate, systemToken]);

  useEffect(() => {
    if (!cursor) return;
    loadPayments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor]);

  if (loading && payments.length === 0) {
    return (
      <div className="flex justify-center py-8">
        <Spinner size="md" />
      </div>
    );
  }

  if (payments.length === 0) {
    return (
      <div className="text-center py-8 text-[var(--color-light-text)]">
        {t("common.noResults")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {payments.map((p) => (
        <div
          key={p.id}
          className="flex items-center justify-between backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-lg p-4 flex-wrap gap-2"
        >
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-white font-medium">
              {formatPrice(p.amount, p.currency)}
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
              {formatDate(p.createdAt)}
            </span>
          </div>
          <div>
            {p.invoiceUrl
              ? (
                <a
                  href={p.invoiceUrl}
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
      ))}
      {nextCursor && (
        <div className="flex justify-center pt-4">
          <button
            onClick={() => setCursor(nextCursor)}
            disabled={loading}
            className="rounded-lg border border-[var(--color-dark-gray)] px-6 py-2 text-sm text-[var(--color-light-text)] hover:border-[var(--color-primary-green)] hover:text-white transition-colors flex items-center gap-2"
          >
            {loading ? <Spinner size="sm" /> : null}
            {t("common.loadMore")}
          </button>
        </div>
      )}
    </div>
  );
}

export default function BillingPage() {
  const { t } = useLocale();
  const { systemToken } = useAuth();
  const { companyId, systemId } = useSystemContext();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [plans, setPlans] = useState<PlanInfo[]>([]);
  const [planMap, setPlanMap] = useState<Record<string, PlanInfo>>({});
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodInfo[]>([]);
  const [creditPurchases, setCreditPurchases] = useState<CreditPurchaseInfo[]>(
    [],
  );
  const [creditsBalance, setCreditsBalance] = useState(0);

  // Action states
  const [subscribing, setSubscribing] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [removingPm, setRemovingPm] = useState<string | null>(null);
  const [settingDefault, setSettingDefault] = useState<string | null>(null);
  const [purchasingCredits, setPurchasingCredits] = useState(false);
  const [creditAmount, setCreditAmount] = useState("");
  const [creditPmId, setCreditPmId] = useState("");

  // Voucher — per-section feedback
  const [applyingVoucher, setApplyingVoucher] = useState(false);
  const [voucherCode, setVoucherCode] = useState("");
  const [voucherError, setVoucherError] = useState<string | null>(null);
  const [voucherSuccess, setVoucherSuccess] = useState<string | null>(null);

  // Auto-recharge
  const [autoRechargeEnabled, setAutoRechargeEnabled] = useState(false);
  const [autoRechargeAmount, setAutoRechargeAmount] = useState("");
  const [savingAutoRecharge, setSavingAutoRecharge] = useState(false);

  // Retry payment
  const [retrying, setRetrying] = useState(false);

  // Pending async payments
  const [pendingAsyncPayments, setPendingAsyncPayments] = useState<
    PaymentRecord[]
  >([]);

  // Payment history
  const [paymentHistoryStart, setPaymentHistoryStart] = useState<
    Date | undefined
  >();
  const [paymentHistoryEnd, setPaymentHistoryEnd] = useState<
    Date | undefined
  >();

  const loadData = useCallback(async () => {
    if (!companyId || !systemId || !systemToken) return;
    setLoading(true);
    setError(null);

    try {
      const [billingRes, plansRes] = await Promise.all([
        fetch(
          `/api/billing`,
          { headers: { Authorization: `Bearer ${systemToken}` } },
        ),
        fetch(
          `/api/core/plans?systemId=${encodeURIComponent(systemId)}&limit=50`,
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

      const allPlans: PlanInfo[] = (plansJson.data ?? []).filter(
        (p: PlanInfo) => p.isActive,
      );
      setPlans(allPlans);

      const map: Record<string, PlanInfo> = {};
      for (const p of allPlans) map[p.id] = p;
      setPlanMap(map);
    } catch {
      setError("common.error.network");
    } finally {
      setLoading(false);
    }
  }, [companyId, systemId, systemToken]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Poll for async payment resolution (§22.9)
  useEffect(() => {
    if (pendingAsyncPayments.length === 0) return;
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [pendingAsyncPayments.length, loadData]);

  // Sync auto-recharge state from active subscription
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

  const activeSub = subscriptions.find((s) => s.status === "active");
  const pastDueSub = subscriptions.find((s) => s.status === "past_due");
  const displaySub = activeSub ?? pastDueSub;
  const activePlan = displaySub ? planMap[displaySub.planId] : null;

  // Compute effective discount from active voucher (single voucher invariant §22.7)
  const activeVoucher: VoucherInfo | null = activeSub?.voucherId &&
      typeof activeSub.voucherId === "object" &&
      (!activeSub.voucherId.expiresAt ||
        new Date(activeSub.voucherId.expiresAt) > new Date())
    ? activeSub.voucherId
    : null;
  const totalVoucherModifier = activeVoucher?.priceModifier ?? 0;

  const effectivePrice = (basePrice: number) =>
    Math.max(0, basePrice + totalVoucherModifier);

  const formatPrice = (price: number, currency: string) => {
    if (price === 0) return t("billing.onboarding.plan.free");
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(price / 100);
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString();
    } catch {
      return dateStr;
    }
  };

  const limitEmoji = (key: string) => {
    const map: Record<string, string> = {
      users: "👥",
      storage: "💾",
      locations: "📍",
      leads: "👤",
      tags: "🏷️",
    };
    return map[key] ?? "📦";
  };

  const formatBytes = (bytes: number) => {
    if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
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
      const res = await fetch("/api/billing", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({
          action: "subscribe",
          planId,
          paymentMethodId: plan?.price > 0 ? defaultPm?.id : undefined,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error?.message ?? "common.error.generic");
      } else {
        await loadData();
      }
    } catch {
      setError("common.error.network");
    } finally {
      setSubscribing(null);
    }
  };

  const handleCancel = async () => {
    if (!companyId || !systemId || !systemToken) return;
    setCancelling(true);
    setError(null);
    try {
      const res = await fetch("/api/billing", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({ action: "cancel" }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error?.message ?? "common.error.generic");
      } else {
        setCancelModalOpen(false);
        await loadData();
      }
    } catch {
      setError("common.error.network");
    } finally {
      setCancelling(false);
    }
  };

  const handleSetDefault = async (pmId: string) => {
    if (!companyId || !systemToken) return;
    setSettingDefault(pmId);
    try {
      await fetch("/api/billing", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({
          action: "set_default_payment_method",
          paymentMethodId: pmId,
        }),
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
    setRemovingPm(pmId);
    try {
      await fetch("/api/billing", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({
          action: "remove_payment_method",
          paymentMethodId: pmId,
        }),
      });
      await loadData();
    } catch {
      setError("common.error.network");
    } finally {
      setRemovingPm(null);
    }
  };

  const handleApplyVoucher = async () => {
    if (!companyId || !systemId || !systemToken || !voucherCode.trim()) return;
    setApplyingVoucher(true);
    setVoucherError(null);
    setVoucherSuccess(null);
    try {
      const res = await fetch("/api/billing", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({
          action: "apply_voucher",
          voucherCode: voucherCode.trim(),
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setVoucherError(json.error?.message ?? "common.error.generic");
      } else {
        setVoucherSuccess("billing.voucher.success");
        setVoucherCode("");
        await loadData();
      }
    } catch {
      setVoucherError("common.error.network");
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
      const res = await fetch("/api/billing", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({
          action: "purchase_credits",
          amount: Number(creditAmount),
          paymentMethodId: creditPmId,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error?.message ?? "common.error.generic");
      } else {
        setCreditAmount("");
        await loadData();
      }
    } catch {
      setError("common.error.network");
    } finally {
      setPurchasingCredits(false);
    }
  };

  const handleSaveAutoRecharge = async () => {
    if (!companyId || !systemId || !systemToken) return;
    setSavingAutoRecharge(true);
    setError(null);
    try {
      const res = await fetch("/api/billing", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({
          action: "set_auto_recharge",
          enabled: autoRechargeEnabled,
          amount: autoRechargeEnabled ? Number(autoRechargeAmount) : 0,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error?.message ?? "common.error.generic");
      } else {
        await loadData();
      }
    } catch {
      setError("common.error.network");
    } finally {
      setSavingAutoRecharge(false);
    }
  };

  const handleRetryPayment = async () => {
    if (!companyId || !systemId || !systemToken) return;
    setRetrying(true);
    setError(null);
    try {
      const res = await fetch("/api/billing", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({ action: "retry_payment" }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error?.message ?? "common.error.generic");
      } else {
        await loadData();
      }
    } catch {
      setError("common.error.network");
    } finally {
      setRetrying(false);
    }
  };

  const inputCls =
    "w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors";

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

      {/* ── Pending Async Payments (§22.9) ── */}
      {pendingAsyncPayments.length > 0 && (
        <div className="backdrop-blur-md bg-white/5 border border-dashed border-yellow-500/40 rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-yellow-400">
            {t("billing.pendingPayments.title")}
          </h2>
          <div className="space-y-3">
            {pendingAsyncPayments.map((p) => {
              const cd = p.continuityData ?? {};
              return (
                <div
                  key={p.id}
                  className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-lg p-4 space-y-3"
                >
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-3">
                      <span className="text-white font-medium">
                        {formatPrice(p.amount, p.currency)}
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
                        {formatDate(p.expiresAt)}
                      </span>
                    )}
                  </div>
                  {/* Continuity data rendering */}
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
            })}
          </div>
        </div>
      )}

      {/* ── Current Plan ── */}
      <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">
          {t("billing.plans.current")}
        </h2>
        {displaySub && activePlan
          ? (
            <div>
              {/* Payment error badge + retry for past_due */}
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

              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xl font-bold text-[var(--color-primary-green)]">
                  {t(activePlan.name) !== activePlan.name
                    ? t(activePlan.name)
                    : activePlan.name}
                </h3>
                <div className="text-right">
                  {totalVoucherModifier !== 0
                    ? (
                      <div>
                        <span className="line-through text-sm text-[var(--color-light-text)] mr-2">
                          {formatPrice(activePlan.price, activePlan.currency)}
                        </span>
                        <span className="text-lg font-bold text-[var(--color-primary-green)]">
                          {formatPrice(
                            effectivePrice(activePlan.price),
                            activePlan.currency,
                          )}
                        </span>
                      </div>
                    )
                    : (
                      <span className="text-lg font-semibold text-white">
                        {formatPrice(activePlan.price, activePlan.currency)}
                      </span>
                    )}
                  {activePlan.price > 0 && (
                    <p className="text-xs text-[var(--color-light-text)]">
                      /{activePlan.recurrenceDays}{" "}
                      {t("billing.onboarding.plan.days")}
                    </p>
                  )}
                </div>
              </div>

              {/* Active voucher */}
              {activeVoucher && (
                <div className="mb-3 flex flex-wrap gap-2">
                  <span
                    key={activeVoucher.id}
                    className="inline-flex items-center gap-1 text-xs bg-[var(--color-primary-green)]/10 border border-[var(--color-primary-green)]/30 text-[var(--color-primary-green)] px-2 py-0.5 rounded-full"
                  >
                    🏷️ {activeVoucher.code} {activeVoucher.priceModifier < 0
                      ? `(-${
                        formatPrice(
                          Math.abs(activeVoucher.priceModifier),
                          activePlan.currency,
                        )
                      })`
                      : activeVoucher.priceModifier > 0
                      ? `(+${
                        formatPrice(
                          activeVoucher.priceModifier,
                          activePlan.currency,
                        )
                      })`
                      : ""}
                  </span>
                  {activeVoucher.creditIncrement > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs bg-[var(--color-secondary-blue)]/10 border border-[var(--color-secondary-blue)]/30 text-[var(--color-secondary-blue)] px-2 py-0.5 rounded-full">
                      💰 +{activeVoucher.creditIncrement}
                    </span>
                  )}
                </div>
              )}

              {activePlan.description && (
                <p className="text-sm text-[var(--color-light-text)] mb-3">
                  {t(activePlan.description) !== activePlan.description
                    ? t(activePlan.description)
                    : activePlan.description}
                </p>
              )}
              <p className="text-sm text-[var(--color-light-text)] mb-4">
                {t("billing.plans.nextBilling")}:{" "}
                {formatDate(displaySub.currentPeriodEnd)}
              </p>

              {/* Benefits */}
              {activePlan.benefits?.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-semibold uppercase tracking-wider bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent mb-2">
                    {t("billing.plans.benefits")}
                  </p>
                  <ul className="space-y-1">
                    {activePlan.benefits.map((b, i) => (
                      <li
                        key={i}
                        className="text-sm text-[var(--color-light-text)] flex items-center gap-2"
                      >
                        <span className="text-[var(--color-primary-green)]">
                          ✓
                        </span>
                        {t(b) !== b ? t(b) : b}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Limits */}
              <div className="mb-4">
                <p className="text-xs font-semibold uppercase tracking-wider bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent mb-2">
                  {t("billing.plans.limits")}
                </p>
                <div className="grid grid-cols-2 gap-2 text-sm text-[var(--color-light-text)]">
                  <span>
                    📊 {t("billing.plans.apiRate")}:{" "}
                    {activePlan.apiRateLimit.toLocaleString()}{" "}
                    {t("billing.plans.reqPerMin")}
                  </span>
                  <span>
                    💾 {t("billing.plans.storage")}:{" "}
                    {formatBytes(activePlan.storageLimitBytes)}
                  </span>
                  {activePlan.fileCacheLimitBytes
                    ? (
                      <span>
                        🗂️ {t("billing.plans.fileCache")}:{" "}
                        {formatBytes(activePlan.fileCacheLimitBytes)}
                      </span>
                    )
                    : null}
                  {activePlan.planCredits
                    ? (
                      <span>
                        🪙 {t("billing.plans.planCredits")}:{" "}
                        {activePlan.planCredits.toLocaleString()}{" "}
                        {t("billing.plans.creditsPerPeriod")}
                      </span>
                    )
                    : null}
                  {activePlan.entityLimits &&
                    Object.entries(activePlan.entityLimits).map((
                      [key, val],
                    ) => (
                      <span key={key}>
                        {limitEmoji(key)}{" "}
                        {t(`billing.limits.${key}`) !== `billing.limits.${key}`
                          ? t(`billing.limits.${key}`)
                          : key}: {val.toLocaleString()}
                      </span>
                    ))}
                  <span>
                    ⬇️ {t("billing.limits.maxConcurrentDownloads")}:{" "}
                    {activePlan.maxConcurrentDownloads
                      ? activePlan.maxConcurrentDownloads
                      : t("billing.limits.unlimited")}
                  </span>
                  <span>
                    ⬆️ {t("billing.limits.maxConcurrentUploads")}:{" "}
                    {activePlan.maxConcurrentUploads
                      ? activePlan.maxConcurrentUploads
                      : t("billing.limits.unlimited")}
                  </span>
                  <span>
                    📶 {t("billing.limits.maxDownloadBandwidthMB")}:{" "}
                    {activePlan.maxDownloadBandwidthMB
                      ? `${activePlan.maxDownloadBandwidthMB} MB/s`
                      : t("billing.limits.unlimited")}
                  </span>
                  <span>
                    📶 {t("billing.limits.maxUploadBandwidthMB")}:{" "}
                    {activePlan.maxUploadBandwidthMB
                      ? `${activePlan.maxUploadBandwidthMB} MB/s`
                      : t("billing.limits.unlimited")}
                  </span>
                  <span>
                    🔢 {t("billing.limits.maxOperationCount")}:{" "}
                    {activePlan.maxOperationCount
                      ? activePlan.maxOperationCount.toLocaleString()
                      : t("billing.limits.unlimited")}
                  </span>
                </div>
              </div>

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

      {/* ── Available Plans ── */}
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
              {plans.map((plan) => {
                const isCurrent = activeSub?.planId === plan.id;
                const base = plan.price;
                const effective = effectivePrice(base);
                const hasDiscount = isCurrent &&
                  totalVoucherModifier !== 0 &&
                  base > 0;
                return (
                  <div
                    key={plan.id}
                    className={`backdrop-blur-md bg-white/5 border rounded-2xl p-6 transition-all duration-200 ${
                      isCurrent
                        ? "border-[var(--color-primary-green)] shadow-lg shadow-[var(--color-light-green)]/20 -translate-y-1"
                        : "border-dashed border-[var(--color-dark-gray)] hover:-translate-y-1 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-xl font-bold text-white">
                        {t(plan.name) !== plan.name ? t(plan.name) : plan.name}
                      </h3>
                      {isCurrent && (
                        <span className="text-xs bg-[var(--color-primary-green)]/20 text-[var(--color-primary-green)] px-2 py-1 rounded-full">
                          {t("billing.plans.current")}
                        </span>
                      )}
                    </div>

                    <div className="mb-1">
                      {base === 0
                        ? (
                          <span className="bg-[var(--color-primary-green)]/20 text-[var(--color-primary-green)] px-3 py-1 rounded-full text-base">
                            {t("billing.onboarding.plan.free")}
                          </span>
                        )
                        : hasDiscount
                        ? (
                          <div className="flex items-center gap-2">
                            <span className="line-through text-sm text-[var(--color-light-text)]">
                              {formatPrice(base, plan.currency)}
                            </span>
                            <span className="text-2xl font-bold text-[var(--color-primary-green)]">
                              {formatPrice(effective, plan.currency)}
                            </span>
                            <span className="text-xs text-[var(--color-light-text)]">
                              /{plan.recurrenceDays}{" "}
                              {t("billing.onboarding.plan.days")}
                            </span>
                          </div>
                        )
                        : (
                          <div className="flex items-baseline gap-1">
                            <span className="text-2xl font-bold text-[var(--color-primary-green)]">
                              {formatPrice(base, plan.currency)}
                            </span>
                            <span className="text-xs text-[var(--color-light-text)]">
                              /{plan.recurrenceDays}{" "}
                              {t("billing.onboarding.plan.days")}
                            </span>
                          </div>
                        )}
                    </div>

                    {plan.description && (
                      <p className="text-sm text-[var(--color-light-text)] mt-2 mb-3">
                        {t(plan.description) !== plan.description
                          ? t(plan.description)
                          : plan.description}
                      </p>
                    )}

                    {/* Benefits */}
                    {plan.benefits?.length > 0 && (
                      <div className="mb-3">
                        <p className="text-xs font-semibold uppercase tracking-wider bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent mb-1">
                          {t("billing.plans.benefits")}
                        </p>
                        <ul className="space-y-1">
                          {plan.benefits.map((b, i) => (
                            <li
                              key={i}
                              className="text-sm text-[var(--color-light-text)] flex items-center gap-2"
                            >
                              <span className="text-[var(--color-primary-green)]">
                                ✓
                              </span>
                              {t(b) !== b ? t(b) : b}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Limits */}
                    <div className="mb-4">
                      <p className="text-xs font-semibold uppercase tracking-wider bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent mb-1">
                        {t("billing.plans.limits")}
                      </p>
                      <div className="space-y-1 text-sm text-[var(--color-light-text)]">
                        <p>
                          📊 {t("billing.plans.apiRate")}:{" "}
                          {plan.apiRateLimit.toLocaleString()}{" "}
                          {t("billing.plans.reqPerMin")}
                        </p>
                        <p>
                          💾 {t("billing.plans.storage")}:{" "}
                          {formatBytes(plan.storageLimitBytes)}
                        </p>
                        {plan.fileCacheLimitBytes
                          ? (
                            <p>
                              🗂️ {t("billing.plans.fileCache")}:{" "}
                              {formatBytes(plan.fileCacheLimitBytes)}
                            </p>
                          )
                          : null}
                        {plan.planCredits
                          ? (
                            <p>
                              🪙 {t("billing.plans.planCredits")}:{" "}
                              {plan.planCredits.toLocaleString()}{" "}
                              {t("billing.plans.creditsPerPeriod")}
                            </p>
                          )
                          : null}
                        {plan.entityLimits &&
                          Object.entries(plan.entityLimits).map((
                            [key, val],
                          ) => (
                            <p key={key}>
                              {limitEmoji(key)} {t(`billing.limits.${key}`) !==
                                  `billing.limits.${key}`
                                ? t(`billing.limits.${key}`)
                                : key}: {val.toLocaleString()}
                            </p>
                          ))}
                        <p>
                          ⬇️ {t("billing.limits.maxConcurrentDownloads")}:{" "}
                          {plan.maxConcurrentDownloads
                            ? plan.maxConcurrentDownloads
                            : t("billing.limits.unlimited")}
                        </p>
                        <p>
                          ⬆️ {t("billing.limits.maxConcurrentUploads")}:{" "}
                          {plan.maxConcurrentUploads
                            ? plan.maxConcurrentUploads
                            : t("billing.limits.unlimited")}
                        </p>
                        <p>
                          📶 {t("billing.limits.maxDownloadBandwidthMB")}:{" "}
                          {plan.maxDownloadBandwidthMB
                            ? `${plan.maxDownloadBandwidthMB} MB/s`
                            : t("billing.limits.unlimited")}
                        </p>
                        <p>
                          📶 {t("billing.limits.maxUploadBandwidthMB")}:{" "}
                          {plan.maxUploadBandwidthMB
                            ? `${plan.maxUploadBandwidthMB} MB/s`
                            : t("billing.limits.unlimited")}
                        </p>
                        <p>
                          🔢 {t("billing.limits.maxOperationCount")}:{" "}
                          {plan.maxOperationCount
                            ? plan.maxOperationCount.toLocaleString()
                            : t("billing.limits.unlimited")}
                        </p>
                      </div>
                    </div>

                    {!isCurrent && (
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
                    )}
                  </div>
                );
              })}
            </div>
          )}
      </div>

      {/* ── Payment Methods ── */}
      <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">
          {t("billing.paymentMethods.title")}
        </h2>
        {paymentMethods.length === 0
          ? (
            <p className="text-[var(--color-light-text)] mb-4">
              {t("billing.paymentMethods.empty")}
            </p>
          )
          : (
            <div className="space-y-3 mb-4">
              {paymentMethods.map((pm) => (
                <div
                  key={pm.id}
                  className="flex items-center justify-between backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-lg p-4"
                >
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
                    <button
                      onClick={() => handleRemovePm(pm.id)}
                      disabled={removingPm === pm.id}
                      className="text-xs border border-red-500/30 rounded px-2 py-1 text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-1"
                    >
                      {removingPm === pm.id && <Spinner size="sm" />}
                      {t("billing.paymentMethods.remove")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>

      {/* ── Credits ── */}
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
            const opCap = (activePlan?.maxOperationCount ?? 0) +
              (activeVoucher?.maxOperationCountModifier ?? 0);
            return (
              <div className="ml-6 border-l border-[var(--color-dark-gray)] pl-6">
                <p className="text-sm text-[var(--color-light-text)]">
                  {t("billing.limits.maxOperationCount")}
                </p>
                <p className="text-2xl font-bold text-[var(--color-secondary-blue)]">
                  {opCap <= 0
                    ? t("billing.limits.unlimited")
                    : `${displaySub.remainingOperationCount.toLocaleString()} / ${opCap.toLocaleString()}`}
                </p>
              </div>
            );
          })()}
        </div>

        {/* Purchase */}
        {paymentMethods.length > 0 && (
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
                {paymentMethods.map((pm) => (
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

        {/* History */}
        {creditPurchases.length > 0 && (
          <div className="border-t border-[var(--color-dark-gray)] pt-4">
            <h3 className="text-sm font-semibold text-white mb-3">
              {t("billing.credits.history")}
            </h3>
            <div className="space-y-2">
              {creditPurchases.map((cp) => (
                <div
                  key={cp.id}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-white">
                    {cp.amount.toLocaleString()}
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
                      {formatDate(cp.createdAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Auto-Recharge Credits */}
        {activeSub && (
          <div className="border-t border-[var(--color-dark-gray)] pt-4 mb-4">
            <h3 className="text-sm font-semibold text-white mb-3">
              {t("billing.credits.autoRecharge.title")}
            </h3>
            <p className="text-sm text-[var(--color-light-text)] mb-3">
              {t("billing.credits.autoRecharge.description")}
            </p>
            {!paymentMethods.some((pm) => pm.isDefault)
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

      {/* ── Voucher ── */}
      <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">
          {t("billing.voucher.title")}
        </h2>
        <div className="flex gap-3">
          <input
            type="text"
            value={voucherCode}
            onChange={(e) => {
              setVoucherCode(e.target.value);
              setVoucherError(null);
              setVoucherSuccess(null);
            }}
            placeholder={t("billing.voucher.code")}
            className={`${inputCls} flex-1`}
          />
          <button
            onClick={handleApplyVoucher}
            disabled={applyingVoucher || !voucherCode.trim()}
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

        {/* Inline voucher feedback */}
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

        {/* Applied voucher */}
        {activeVoucher && (
          <div className="mt-4 border-t border-[var(--color-dark-gray)] pt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-light-text)] mb-2">
              {t("billing.voucher.applied")}
            </p>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1 text-xs bg-[var(--color-primary-green)]/10 border border-[var(--color-primary-green)]/30 text-[var(--color-primary-green)] px-3 py-1 rounded-full">
                🏷️ {activeVoucher.code}
                {activeVoucher.priceModifier !== 0 && activePlan && (
                  <span className="ml-1 opacity-70">
                    {activeVoucher.priceModifier < 0 ? "-" : "+"}
                    {formatPrice(
                      Math.abs(activeVoucher.priceModifier),
                      activePlan.currency,
                    )}
                  </span>
                )}
              </span>
              {activeVoucher.creditIncrement > 0 && (
                <span className="inline-flex items-center gap-1 text-xs bg-[var(--color-secondary-blue)]/10 border border-[var(--color-secondary-blue)]/30 text-[var(--color-secondary-blue)] px-3 py-1 rounded-full">
                  💰 +{activeVoucher.creditIncrement}{" "}
                  {t("billing.credits.title")}
                </span>
              )}
              {(activeVoucher.maxConcurrentDownloadsModifier ?? 0) !== 0 && (
                <span className="inline-flex items-center gap-1 text-xs bg-[var(--color-secondary-blue)]/10 border border-[var(--color-secondary-blue)]/30 text-[var(--color-secondary-blue)] px-3 py-1 rounded-full">
                  ⬇️ {(activeVoucher.maxConcurrentDownloadsModifier ?? 0) > 0
                    ? "+"
                    : ""}
                  {activeVoucher.maxConcurrentDownloadsModifier}{" "}
                  {t("billing.limits.maxConcurrentDownloads")}
                </span>
              )}
              {(activeVoucher.maxConcurrentUploadsModifier ?? 0) !== 0 && (
                <span className="inline-flex items-center gap-1 text-xs bg-[var(--color-secondary-blue)]/10 border border-[var(--color-secondary-blue)]/30 text-[var(--color-secondary-blue)] px-3 py-1 rounded-full">
                  ⬆️ {(activeVoucher.maxConcurrentUploadsModifier ?? 0) > 0
                    ? "+"
                    : ""}
                  {activeVoucher.maxConcurrentUploadsModifier}{" "}
                  {t("billing.limits.maxConcurrentUploads")}
                </span>
              )}
              {(activeVoucher.maxDownloadBandwidthModifier ?? 0) !== 0 && (
                <span className="inline-flex items-center gap-1 text-xs bg-[var(--color-secondary-blue)]/10 border border-[var(--color-secondary-blue)]/30 text-[var(--color-secondary-blue)] px-3 py-1 rounded-full">
                  📶 {(activeVoucher.maxDownloadBandwidthModifier ?? 0) > 0
                    ? "+"
                    : ""}
                  {activeVoucher.maxDownloadBandwidthModifier} MB/s
                </span>
              )}
              {(activeVoucher.maxUploadBandwidthModifier ?? 0) !== 0 && (
                <span className="inline-flex items-center gap-1 text-xs bg-[var(--color-secondary-blue)]/10 border border-[var(--color-secondary-blue)]/30 text-[var(--color-secondary-blue)] px-3 py-1 rounded-full">
                  📶{" "}
                  {(activeVoucher.maxUploadBandwidthModifier ?? 0) > 0
                    ? "+"
                    : ""}
                  {activeVoucher.maxUploadBandwidthModifier} MB/s
                </span>
              )}
              {(activeVoucher.maxOperationCountModifier ?? 0) !== 0 && (
                <span className="inline-flex items-center gap-1 text-xs bg-[var(--color-secondary-blue)]/10 border border-[var(--color-secondary-blue)]/30 text-[var(--color-secondary-blue)] px-3 py-1 rounded-full">
                  🔢{" "}
                  {(activeVoucher.maxOperationCountModifier ?? 0) > 0
                    ? "+"
                    : ""}
                  {activeVoucher.maxOperationCountModifier}{" "}
                  {t("billing.limits.maxOperationCount")}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Payment History ── */}
      <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">
          {t("billing.paymentHistory.title")}
        </h2>
        <div className="mb-4">
          <DateRangeFilter
            maxRangeDays={365}
            onChange={(start, end) => {
              setPaymentHistoryStart(start);
              setPaymentHistoryEnd(end);
            }}
          />
        </div>
        {companyId && systemId && (
          <PaymentHistoryList
            systemToken={systemToken}
            companyId={companyId}
            systemId={systemId}
            startDate={paymentHistoryStart}
            endDate={paymentHistoryEnd}
            formatPrice={formatPrice}
            formatDate={formatDate}
          />
        )}
      </div>

      {/* Cancel confirmation modal */}
      {cancelModalOpen && (
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
      )}
    </div>
  );
}
