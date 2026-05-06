"use client";

import { useCallback, useEffect, useState } from "react";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import GenericFormButton from "@/src/components/shared/GenericFormButton";
import { useTenantContext } from "@/src/hooks/useTenantContext";
import type { CompanyView } from "@/src/contracts/high-level/companies";

export default function CompanyEditPage() {
  const { t } = useTenantContext();
  const { systemToken } = useTenantContext();
  const { companyId } = useTenantContext();

  const [company, setCompany] = useState<CompanyView | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [name, setName] = useState("");
  const [document, setDocument] = useState("");
  const [documentType, setDocumentType] = useState("cnpj");

  const loadCompany = useCallback(async () => {
    if (!systemToken || !companyId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/companies?search=&limit=50`,
        { headers: { Authorization: `Bearer ${systemToken}` } },
      );
      const json = await res.json();
      const found = (json.items ?? []).find(
        (c: CompanyView) => c.id === companyId,
      );
      if (found) {
        setCompany(found);
        setName(found.name);
        setDocument(found.document);
        setDocumentType(found.documentType);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [systemToken, companyId]);

  useEffect(() => {
    loadCompany();
  }, [loadCompany]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company) return;
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch("/api/companies", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({
          id: company.id,
          name,
          document,
          documentType,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error?.message ?? "common.error.generic");
      } else {
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      }
    } catch {
      setError("common.error.network");
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-3 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors";

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
        {t("billing.onboarding.company.title")}
      </h1>

      <ErrorDisplay message={error} />

      {success && (
        <div className="rounded-lg bg-[var(--color-primary-green)]/10 border border-[var(--color-primary-green)]/30 p-3 text-sm text-[var(--color-primary-green)]">
          {t("common.saved")}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-4">
        <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("billing.onboarding.company.name")}
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
              {t("billing.onboarding.company.document")}
            </label>
            <input
              type="text"
              value={document}
              onChange={(e) => setDocument(e.target.value)}
              required
              className={inputCls}
            />
          </div>
        </div>

        <GenericFormButton loading={saving} label={t("common.save")} />
      </form>
    </div>
  );
}
