"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import GenericFormButton from "@/src/components/shared/GenericFormButton";
import Modal from "@/src/components/shared/Modal";
import GenericList from "@/src/components/shared/GenericList";
import PlanCard from "@/src/components/shared/PlanCard";
import DeleteButton from "@/src/components/shared/DeleteButton";
import PaymentMethodSubform, {
  type PaymentMethodSubformRef,
} from "@/src/components/subforms/PaymentMethodSubform";
import type { SystemOption } from "@/src/contracts/high-level/components";
import type {
  PlanOption,
  VoucherPreview,
} from "@/src/contracts/high-level/billing-display";
import type { ResourceLimitsData } from "@/src/contracts/high-level/resource-limits";
import { useTenantContext } from "@/src/hooks/useTenantContext";
import type { PaginatedResult } from "@/src/contracts/high-level/pagination";

interface OnboardingPaymentMethod {
  id: string;
  cardMask: string;
  holderName: string;
  isDefault: boolean;
  [key: string]: unknown;
}

export default function OnboardingSystemPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedSlug = searchParams.get("systemSlug");
  const { t } = useTenantContext();
  const { systemToken } = useTenantContext();

  const [step, setStep] = useState<"system" | "plan">("system");
  const [systems, setSystems] = useState<SystemOption[]>([]);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSystem, setSelectedSystem] = useState<SystemOption | null>(
    null,
  );
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);

  // Payment methods (managed locally during onboarding)
  const [paymentMethods, setPaymentMethods] = useState<
    OnboardingPaymentMethod[]
  >([]);
  const [showPmModal, setShowPmModal] = useState(false);
  const [addingPm, setAddingPm] = useState(false);
  const [pmError, setPmError] = useState<string | null>(null);
  const pmRef = useRef<PaymentMethodSubformRef>(null);

  // Voucher (virtual — preview only)
  const [voucherName, setvoucherName] = useState("");
  const [voucherPreview, setVoucherPreview] = useState<VoucherPreview | null>(
    null,
  );
  const [validatingVoucher, setValidatingVoucher] = useState(false);
  const [voucherError, setVoucherError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/public/system?list=true")
      .then((r) => r.json())
      .then((json) => {
        if (json.success) {
          const list: SystemOption[] = json.data ?? [];
          setSystems(list);
          if (preselectedSlug) {
            const match = list.find((s) => s.slug === preselectedSlug);
            if (match) setSelectedSystem(match);
          }
        }
      })
      .finally(() => setLoading(false));
  }, [preselectedSlug]);

  const handleSelectSystem = async () => {
    if (!selectedSystem) return;
    setLoadingPlans(true);
    setError(null);

    try {
      const systemWithPlans = systems.find((s) => s.id === selectedSystem.id) as
        | (SystemOption & { plans?: PlanOption[] })
        | undefined;
      const activePlans = (systemWithPlans?.plans ?? []).filter(
        (p: PlanOption) => p.isActive,
      );
      setPlans(activePlans);
      setStep("plan");
    } catch {
      setError("common.error.network");
    } finally {
      setLoadingPlans(false);
    }
  };

  const selectedPlanData = plans.find((p) => p.id === selectedPlan);
  const planRequiresPayment = (selectedPlanData?.price ?? 0) > 0;

  const sortedPms = useMemo(
    () =>
      [...paymentMethods].sort((a, b) => {
        if (a.isDefault && !b.isDefault) return -1;
        if (!a.isDefault && b.isDefault) return 1;
        return 0;
      }),
    [paymentMethods],
  );

  const fetchPaymentMethods = useCallback(
    async (): Promise<PaginatedResult<OnboardingPaymentMethod>> => ({
      items: sortedPms,
      total: sortedPms.length,
      hasMore: false,
    }),
    [sortedPms],
  );

  const handleValidateVoucher = useCallback(async () => {
    if (!voucherName.trim() || !systemToken) return;
    setValidatingVoucher(true);
    setVoucherError(null);
    try {
      const res = await fetch("/api/billing", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({
          action: "validate_voucher",
          voucherName: voucherName.trim(),
          planId: selectedPlan,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setVoucherError(json.error?.message ?? "common.error.generic");
        setVoucherPreview(null);
      } else {
        const v = json.data;
        const rl = v.resourceLimitId as ResourceLimitsData | null;
        setVoucherPreview({
          id: v.id,
          name: v.name,
          priceModifier: rl?.priceModifier ?? 0,
          resourceLimitId: rl,
          expiresAt: v.expiresAt,
        });
        setVoucherError(null);
      }
    } catch {
      setVoucherError("common.error.network");
      setVoucherPreview(null);
    } finally {
      setValidatingVoucher(false);
    }
  }, [voucherName, systemToken, selectedPlan]);

  const handleRemoveVoucher = () => {
    setVoucherPreview(null);
    setvoucherName("");
    setVoucherError(null);
  };

  const handleRemovePm = async (pmId: string) => {
    setPaymentMethods((prev) => {
      const filtered = prev.filter((p) => p.id !== pmId);
      if (filtered.length > 0 && !filtered.some((p) => p.isDefault)) {
        filtered[0].isDefault = true;
      }
      return filtered;
    });
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
        isDefault: wantsDefault,
      } = await pmRef.current.submitData();

      const res = await fetch("/api/billing", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({
          action: "add_payment_method",
          cardToken,
          cardMask,
          holderName,
          holderDocument,
          billingAddress,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setPmError(json.error?.message ?? "common.error.generic");
        return;
      }

      const pm = json.data;
      const isDefault = paymentMethods.length === 0 || !!wantsDefault;

      setPaymentMethods((prev) => {
        const updated = isDefault
          ? prev.map((p) => ({ ...p, isDefault: false }))
          : prev;
        return [
          ...updated,
          {
            id: pm.id,
            cardMask: pm.cardMask ?? cardMask,
            holderName,
            isDefault,
          },
        ];
      });
      setShowPmModal(false);
    } catch {
      setPmError("common.error.network");
    } finally {
      setAddingPm(false);
    }
  };

  const handleSubscribe = async () => {
    if (!selectedSystem || !selectedPlan || !systemToken) return;

    if (planRequiresPayment && paymentMethods.length === 0) {
      setError("billing.paymentMethods.required");
      return;
    }

    setSubscribing(true);
    setError(null);

    try {
      const compRes = await fetch("/api/companies", {
        headers: { Authorization: `Bearer ${systemToken}` },
      });
      const compJson = await compRes.json();
      const companies = compJson.success ? (compJson.items ?? []) : [];
      if (companies.length === 0) {
        router.push("/onboarding/company");
        return;
      }
      const companyId = companies[0].id;

      const defaultPm = paymentMethods.find((p) => p.isDefault);

      const res = await fetch("/api/billing", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({
          action: "subscribe",
          companyId,
          systemId: selectedSystem.id,
          planId: selectedPlan,
          paymentMethodId: planRequiresPayment ? defaultPm?.id : undefined,
          voucherName: voucherPreview ? voucherName.trim() : undefined,
        }),
      });
      const json = await res.json();

      if (!json.success) {
        setError(json.error?.message ?? "common.error.generic");
        return;
      }

      router.push("/entry");
    } catch {
      setError("common.error.network");
    } finally {
      setSubscribing(false);
    }
  };

  const inputCls =
    "w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white outline-none focus:border-[var(--color-primary-green)] transition-colors placeholder-white/30";

  return (
    <div className="max-w-2xl mx-auto">
      <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-2xl p-8">
        {step === "system"
          ? (
            <>
              <div className="mb-8 text-center">
                <div className="text-4xl mb-3">🔌</div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
                  {t("billing.onboarding.system.title")}
                </h1>
                <p className="mt-2 text-[var(--color-light-text)]">
                  {t("billing.onboarding.system.subtitle")}
                </p>
              </div>

              <ErrorDisplay message={error} />

              {loading
                ? (
                  <div className="flex justify-center py-8">
                    <Spinner size="lg" />
                  </div>
                )
                : systems.length === 0
                ? (
                  <p className="text-center text-[var(--color-light-text)]">
                    {t("billing.onboarding.system.empty")}
                  </p>
                )
                : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                    {systems.map((sys) => (
                      <button
                        key={sys.id}
                        onClick={() => setSelectedSystem(sys)}
                        className={`text-left backdrop-blur-md bg-white/5 border rounded-xl p-4 transition-all duration-200 ${
                          selectedSystem?.id === sys.id
                            ? "border-[var(--color-primary-green)] shadow-lg shadow-[var(--color-light-green)]/20 -translate-y-1"
                            : "border-dashed border-[var(--color-dark-gray)] hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          {sys.logoUri && (
                            <img
                              src={`/api/files/download?uri=${
                                encodeURIComponent(sys.logoUri)
                              }`}
                              alt={sys.name}
                              className="w-10 h-10 rounded"
                            />
                          )}
                          <div>
                            <h3 className="font-semibold text-white">
                              {sys.name}
                            </h3>
                            <p className="text-xs text-[var(--color-light-text)]">
                              {sys.slug}
                            </p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

              <button
                onClick={handleSelectSystem}
                disabled={!selectedSystem || loadingPlans}
                className="w-full rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-4 py-3 font-semibold text-black transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loadingPlans
                  ? (
                    <Spinner
                      size="sm"
                      className="border-black border-t-transparent"
                    />
                  )
                  : null}
                {t("common.next")}
              </button>
            </>
          )
          : (
            <>
              <div className="mb-8 text-center">
                <div className="text-4xl mb-3">📋</div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
                  {t("billing.onboarding.plan.title")}
                </h1>
                <p className="mt-2 text-[var(--color-light-text)]">
                  {t("billing.onboarding.plan.subtitle")}
                </p>
              </div>

              <ErrorDisplay message={error} />

              {/* Plan selection */}
              {plans.length === 0
                ? (
                  <p className="text-center text-[var(--color-light-text)]">
                    {t("billing.onboarding.plan.empty")}
                  </p>
                )
                : (
                  <div className="space-y-4 mb-6">
                    {plans.map((plan) => (
                      <PlanCard
                        key={plan.id}
                        plan={plan}
                        variant="onboarding"
                        systemSlug={selectedSystem?.slug}
                        voucher={selectedPlan === plan.id
                          ? voucherPreview
                          : null}
                        highlighted={selectedPlan === plan.id}
                        onClick={() => {
                          setSelectedPlan(plan.id);
                          if (voucherPreview) {
                            setVoucherPreview(null);
                            setvoucherName("");
                          }
                        }}
                      />
                    ))}
                  </div>
                )}

              {/* Voucher field (virtual preview) */}
              {selectedPlan && (
                <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-5 mb-6">
                  <h3 className="text-sm font-semibold text-white mb-3">
                    🏷️ {t("billing.voucher.title")}
                  </h3>
                  <div className="flex gap-3">
                    <input
                      type="text"
                      value={voucherName}
                      onChange={(e) => {
                        setvoucherName(e.target.value);
                        setVoucherError(null);
                        if (voucherPreview) {
                          setVoucherPreview(null);
                        }
                      }}
                      placeholder={t("billing.voucher.name")}
                      className={`${inputCls} flex-1`}
                    />
                    {voucherPreview
                      ? (
                        <button
                          onClick={handleRemoveVoucher}
                          className="rounded-lg border border-red-500/30 px-4 py-2 text-red-400 hover:bg-red-500/10 transition-colors text-sm"
                        >
                          ✕
                        </button>
                      )
                      : (
                        <button
                          onClick={handleValidateVoucher}
                          disabled={validatingVoucher || !voucherName.trim()}
                          className="rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-4 py-2 font-semibold text-black transition-all hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
                        >
                          {validatingVoucher && (
                            <Spinner
                              size="sm"
                              className="border-black border-t-transparent"
                            />
                          )}
                          {t("billing.voucher.apply")}
                        </button>
                      )}
                  </div>
                  {voucherError && (
                    <div className="mt-2 rounded-lg bg-red-500/10 border border-red-500/30 p-2 text-sm text-red-400">
                      ❌ {t(voucherError)}
                    </div>
                  )}
                  {voucherPreview && (
                    <div className="mt-2 rounded-lg bg-[var(--color-primary-green)]/10 border border-[var(--color-primary-green)]/30 p-2 text-sm text-[var(--color-primary-green)]">
                      ✅ {voucherPreview.name}
                    </div>
                  )}
                </div>
              )}

              {/* Payment methods via GenericList */}
              {selectedPlan && planRequiresPayment && (
                <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-5 mb-6">
                  <GenericList<OnboardingPaymentMethod>
                    entityName={t("billing.paymentMethods.title")}
                    searchEnabled={false}
                    createEnabled={true}
                    controlButtons={[]}
                    onCreateClick={() => {
                      setPmError(null);
                      setShowPmModal(true);
                    }}
                    fetchFn={fetchPaymentMethods}
                    reloadKey={paymentMethods.length}
                    renderItem={(pm) => (
                      <div className="flex items-center justify-between backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-lg p-4">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">💳</span>
                          <div>
                            <p className="text-white font-medium">
                              {pm.cardMask}
                            </p>
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
                        <DeleteButton
                          onConfirm={() => handleRemovePm(pm.id)}
                        />
                      </div>
                    )}
                  />
                </div>
              )}

              {/* Subscribe */}
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setStep("system");
                    setSelectedPlan(null);
                    setError(null);
                    setVoucherPreview(null);
                    setvoucherName("");
                  }}
                  className="rounded-lg border border-[var(--color-dark-gray)] px-4 py-3 text-[var(--color-light-text)] hover:bg-white/5 transition-colors"
                >
                  {t("common.back")}
                </button>
                <button
                  onClick={handleSubscribe}
                  disabled={!selectedPlan || subscribing ||
                    (planRequiresPayment && paymentMethods.length === 0)}
                  className="flex-1 rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-4 py-3 font-semibold text-black transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {subscribing
                    ? (
                      <Spinner
                        size="sm"
                        className="border-black border-t-transparent"
                      />
                    )
                    : null}
                  {t("billing.onboarding.plan.subscribe")}
                </button>
              </div>
            </>
          )}
      </div>

      {/* Payment method modal using PaymentMethodSubform */}
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
