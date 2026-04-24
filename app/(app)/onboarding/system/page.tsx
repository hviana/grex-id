"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "@/src/hooks/useLocale";
import { useAuth } from "@/src/hooks/useAuth";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import PlanCard from "@/src/components/shared/PlanCard";

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
  fileCacheLimitBytes: number;
  maxConcurrentDownloads: number;
  maxConcurrentUploads: number;
  maxDownloadBandwidthMB: number;
  maxUploadBandwidthMB: number;
  maxOperationCount?: Record<string, number>;
  isActive: boolean;
}

export default function OnboardingSystemPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedSlug = searchParams.get("systemSlug");
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
      // Plans are already included in the public system list response
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
                      <PlanCard
                        key={plan.id}
                        plan={plan}
                        variant="onboarding"
                        systemSlug={selectedSystem?.slug}
                        highlighted={selectedPlan === plan.id}
                        onClick={() => setSelectedPlan(plan.id)}
                      />
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
