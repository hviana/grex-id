"use client";

import { useCallback, useState } from "react";
import { useLocale } from "@/src/hooks/useLocale";
import { useAuth } from "@/src/hooks/useAuth";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import Modal from "@/src/components/shared/Modal";
import SearchableSelectField from "@/src/components/fields/SearchableSelectField";

export default function DataDeletion() {
  const { t } = useLocale();
  const { systemToken } = useAuth();

  const [selectedCompany, setSelectedCompany] = useState<
    {
      id: string;
      name: string;
    } | null
  >(null);
  const [selectedSystem, setSelectedSystem] = useState<
    {
      id: string;
      name: string;
    } | null
  >(null);
  const [showModal, setShowModal] = useState(false);
  const [awareness, setAwareness] = useState(false);
  const [password, setPassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const companyFetchFn = useCallback(
    async (search: string) => {
      const res = await fetch(
        `/api/companies?search=${encodeURIComponent(search)}&limit=10`,
        { headers: { Authorization: `Bearer ${systemToken}` } },
      );
      const json = await res.json();
      return (json.data ?? []).map((c: { id: string; name: string }) => ({
        id: c.id,
        label: c.name,
      }));
    },
    [systemToken],
  );

  const systemFetchFn = useCallback(
    async (search: string) => {
      const res = await fetch(
        `/api/core/systems?search=${encodeURIComponent(search)}&limit=10`,
        { headers: { Authorization: `Bearer ${systemToken}` } },
      );
      const json = await res.json();
      return (json.data ?? []).map((s: { id: string; name: string }) => ({
        id: s.id,
        label: s.name,
      }));
    },
    [systemToken],
  );

  const handleDelete = async () => {
    if (!selectedCompany || !selectedSystem || !password) return;

    setDeleting(true);
    setError(null);

    try {
      const res = await fetch("/api/core/data-deletion", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({
          companyId: selectedCompany.id,
          systemId: selectedSystem.id,
          password,
        }),
      });
      const json = await res.json();

      if (!json.success) {
        setError(
          json.error?.message ?? json.error?.errors?.[0] ??
            "common.error.generic",
        );
        return;
      }

      setSuccess(t("core.dataDeletion.success"));
      setShowModal(false);
      setSelectedCompany(null);
      setSelectedSystem(null);
      resetModal();
    } catch {
      setError("common.error.network");
    } finally {
      setDeleting(false);
    }
  };

  const resetModal = () => {
    setAwareness(false);
    setPassword("");
    setError(null);
  };

  const openModal = () => {
    resetModal();
    setSuccess(null);
    setShowModal(true);
  };

  const inputCls =
    "w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white outline-none focus:border-[var(--color-primary-green)] transition-colors";

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent mb-6">
        {t("core.dataDeletion.title")}
      </h1>

      {success && (
        <div className="mb-4 p-3 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-sm">
          {success}
        </div>
      )}

      <div className="space-y-6">
        {/* Company Search */}
        <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-5">
          <label className="block text-sm font-medium text-[var(--color-light-text)] mb-2">
            {t("core.dataDeletion.selectedCompany")}
          </label>
          <SearchableSelectField
            fetchFn={companyFetchFn}
            onChange={(items) => {
              setSelectedCompany(
                items.length > 0
                  ? { id: items[0].id, name: items[0].label }
                  : null,
              );
            }}
            placeholder={t("core.dataDeletion.selectCompany")}
          />
        </div>

        {/* System Search */}
        <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-5">
          <label className="block text-sm font-medium text-[var(--color-light-text)] mb-2">
            {t("core.dataDeletion.selectedSystem")}
          </label>
          <SearchableSelectField
            fetchFn={systemFetchFn}
            onChange={(items) => {
              setSelectedSystem(
                items.length > 0
                  ? { id: items[0].id, name: items[0].label }
                  : null,
              );
            }}
            placeholder={t("core.dataDeletion.selectSystem")}
          />
        </div>

        {/* Delete Button */}
        <button
          type="button"
          onClick={openModal}
          disabled={!selectedCompany || !selectedSystem}
          className="w-full rounded-lg bg-red-600 px-4 py-3 font-semibold text-white transition-all hover:bg-red-700 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          🗑️ {t("core.dataDeletion.deleteButton")}
        </button>
      </div>

      {/* Confirmation Modal */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={t("core.dataDeletion.deleteButton")}
      >
        <div className="space-y-5">
          {/* Warning */}
          <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
            ⚠️ {t("core.dataDeletion.warning")}
          </div>

          {/* Selected targets */}
          <div className="text-sm text-[var(--color-light-text)] space-y-1">
            <p>
              <strong className="text-white">
                {t("core.dataDeletion.selectedCompany")}:
              </strong>{" "}
              {selectedCompany?.name}
            </p>
            <p>
              <strong className="text-white">
                {t("core.dataDeletion.selectedSystem")}:
              </strong>{" "}
              {selectedSystem?.name}
            </p>
          </div>

          <ErrorDisplay message={error} />

          {/* Awareness checkbox */}
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={awareness}
              onChange={(e) => setAwareness(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded accent-red-500"
            />
            <span className="text-sm text-[var(--color-light-text)]">
              {t("core.dataDeletion.awareness")}
            </span>
          </label>

          {/* Password re-entry */}
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.dataDeletion.passwordLabel")}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("core.dataDeletion.passwordPlaceholder")}
              className={inputCls}
            />
          </div>

          {/* Action buttons */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowModal(false)}
              className="flex-1 rounded-lg border border-[var(--color-dark-gray)] px-4 py-2.5 text-sm text-[var(--color-light-text)] hover:bg-white/5 transition-colors"
            >
              {t("core.dataDeletion.cancel")}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={!awareness || !password || deleting}
              className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
            >
              {deleting
                ? (
                  <Spinner
                    size="sm"
                    className="border-white border-t-transparent"
                  />
                )
                : null}
              {t("core.dataDeletion.confirmDelete")}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
