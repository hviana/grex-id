"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import { useTenantContext } from "@/src/hooks/useTenantContext";

export default function OnboardingCompanyPage() {
  const router = useRouter();
  const { t } = useTenantContext();
  const { systemToken } = useTenantContext();

  const [name, setName] = useState("");
  const [document, setDocument] = useState("");
  const [documentType, setDocumentType] = useState("cnpj");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({
          name,
          document,
          documentType,
        }),
      });
      const json = await res.json();

      if (!json.success) {
        setError(json.error?.message ?? "common.error.generic");
        return;
      }

      router.push("/onboarding/system");
    } catch {
      setError("common.error.network");
    } finally {
      setLoading(false);
    }
  };

  const inputCls =
    "w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-3 text-white outline-none focus:border-[var(--color-primary-green)] transition-colors";

  return (
    <div className="max-w-lg mx-auto">
      <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-2xl p-8">
        <div className="mb-8 text-center">
          <div className="text-4xl mb-3">🏢</div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
            {t("billing.onboarding.company.title")}
          </h1>
          <p className="mt-2 text-[var(--color-light-text)]">
            {t("billing.onboarding.company.subtitle")}
          </p>
        </div>

        <ErrorDisplay message={error} />

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("billing.onboarding.company.name")} *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("billing.onboarding.company.documentType")}
            </label>
            <select
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value)}
              className={inputCls}
            >
              <option value="cnpj" className="bg-[var(--color-black)]">
                CNPJ
              </option>
              <option value="ein" className="bg-[var(--color-black)]">
                EIN
              </option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("billing.onboarding.company.document")} *
            </label>
            <input
              type="text"
              value={document}
              onChange={(e) => setDocument(e.target.value)}
              required
              className={inputCls}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-4 py-3 font-semibold text-black transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading
              ? (
                <Spinner
                  size="sm"
                  className="border-black border-t-transparent"
                />
              )
              : null}
            {t("common.next")}
          </button>
        </form>
      </div>
    </div>
  );
}
