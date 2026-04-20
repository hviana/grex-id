"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "@/src/hooks/useLocale";
import { useAuth } from "@/src/hooks/useAuth";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";

interface SystemOption {
  id: string;
  name: string;
  slug: string;
  logoUri: string;
}

interface PlanOption {
  id: string;
  name: string;
  description: string;
  planCredits: number;
  price: number;
  currency: string;
  recurrenceDays: number;
  benefits: string[];
  permissions: string[];
  entityLimits?: Record<string, number>;
  apiRateLimit: number;
  storageLimitBytes: number;
  isActive: boolean;
}

export default function OnboardingSystemPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedSlug = searchParams.get("system");
  const { t } = useLocale();
  const { systemToken } = useAuth();

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

  useEffect(() => {
    fetch("/api/core/systems")
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
      const res = await fetch(
        `/api/core/plans?systemId=${
          encodeURIComponent(selectedSystem.id)
        }&limit=50`,
      );
      const json = await res.json();
      const activePlans = (json.data ?? []).filter(
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

  const handleSubscribe = async () => {
    if (!selectedSystem || !selectedPlan || !systemToken) return;
    setSubscribing(true);
    setError(null);

    try {
      // Get user's companies to find the first one (just created in onboarding)
      const compRes = await fetch("/api/companies", {
        headers: { Authorization: `Bearer ${systemToken}` },
      });
      const compJson = await compRes.json();
      const companies = compJson.success ? (compJson.data ?? []) : [];
      if (companies.length === 0) {
        router.push("/onboarding/company");
        return;
      }
      const companyId = companies[0].id;

      // Create company_system association and subscription
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

  const formatPrice = (price: number, currency: string) => {
    if (price === 0) return t("billing.onboarding.plan.free");
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(price / 100);
  };

  const formatBytes = (bytes: number) => {
    if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
  };

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

              {plans.length === 0
                ? (
                  <p className="text-center text-[var(--color-light-text)]">
                    {t("billing.onboarding.plan.empty")}
                  </p>
                )
                : (
                  <div className="space-y-4 mb-6">
                    {plans.map((plan) => (
                      <button
                        key={plan.id}
                        onClick={() => setSelectedPlan(plan.id)}
                        className={`w-full text-left backdrop-blur-md bg-white/5 border rounded-2xl p-6 transition-all duration-200 ${
                          selectedPlan === plan.id
                            ? "border-[var(--color-primary-green)] shadow-lg shadow-[var(--color-light-green)]/20 -translate-y-1"
                            : "border-dashed border-[var(--color-dark-gray)] hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="font-bold text-white text-xl">
                            {t(plan.name) !== plan.name
                              ? t(plan.name)
                              : plan.name}
                          </h3>
                          <span className="text-2xl font-bold text-[var(--color-primary-green)]">
                            {plan.price === 0
                              ? (
                                <span className="bg-[var(--color-primary-green)]/20 text-[var(--color-primary-green)] px-3 py-1 rounded-full text-base">
                                  {t("billing.onboarding.plan.free")}
                                </span>
                              )
                              : (
                                <>
                                  {formatPrice(plan.price, plan.currency)}
                                  <span className="text-xs text-[var(--color-light-text)] font-normal ml-1">
                                    /{plan.recurrenceDays}{" "}
                                    {t("billing.onboarding.plan.days")}
                                  </span>
                                </>
                              )}
                          </span>
                        </div>
                        {plan.description && (
                          <p className="text-sm text-[var(--color-light-text)] mb-3">
                            {t(plan.description) !== plan.description
                              ? t(plan.description)
                              : plan.description}
                          </p>
                        )}
                        {plan.benefits && plan.benefits.length > 0 && (
                          <div className="mb-3">
                            <p className="text-xs font-semibold uppercase tracking-wider bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent mb-1">
                              {t("billing.plans.benefits")}
                            </p>
                            <ul className="space-y-1">
                              {plan.benefits.map((benefit, i) => (
                                <li
                                  key={i}
                                  className="text-sm text-[var(--color-light-text)] flex items-center gap-2"
                                >
                                  <span className="text-[var(--color-primary-green)]">
                                    ✓
                                  </span>
                                  {t(benefit) !== benefit
                                    ? t(benefit)
                                    : benefit}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wider bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent mb-1">
                            {t("billing.plans.limits")}
                          </p>
                          <div className="space-y-1 text-sm text-[var(--color-light-text)]">
                            <p>
                              📊 {t("billing.plans.apiRate")}:{" "}
                              {plan.apiRateLimit?.toLocaleString() ?? "1,000"}
                              {" "}
                              {t("billing.plans.reqPerMin")}
                            </p>
                            <p>
                              💾 {t("billing.plans.storage")}: {formatBytes(
                                plan.storageLimitBytes ?? 1073741824,
                              )}
                            </p>
                            {plan.planCredits > 0 && (
                              <p>
                                🪙 {t("billing.plans.planCredits")}:{" "}
                                {plan.planCredits.toLocaleString()}{" "}
                                {t("billing.plans.creditsPerPeriod")}
                              </p>
                            )}
                            {plan.entityLimits &&
                              Object.entries(plan.entityLimits).map((
                                [key, val],
                              ) => (
                                <p key={key}>
                                  👥 {t(`billing.limits.${key}`) !==
                                      `billing.limits.${key}`
                                    ? t(`billing.limits.${key}`)
                                    : key}: {val.toLocaleString()}
                                </p>
                              ))}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setStep("system");
                    setSelectedPlan(null);
                    setError(null);
                  }}
                  className="rounded-lg border border-[var(--color-dark-gray)] px-4 py-3 text-[var(--color-light-text)] hover:bg-white/5 transition-colors"
                >
                  {t("common.back")}
                </button>
                <button
                  onClick={handleSubscribe}
                  disabled={!selectedPlan || subscribing}
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
    </div>
  );
}
