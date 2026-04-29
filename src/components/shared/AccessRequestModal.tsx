"use client";

import { useState } from "react";
import Modal from "./Modal";
import Spinner from "./Spinner";
import SearchableSelectField from "@/src/components/fields/SearchableSelectField";
import { useTenantContext } from "@/src/hooks/useTenantContext";

interface AccessRequestModalProps {
  entityType: string;
  entityId: string;
  entityLabel?: string;
  /** When true, shows permission selector (r/w/rw) for restricted entities. */
  isRestricted?: boolean;
  onSuccess: () => void;
  onClose: () => void;
}

export default function AccessRequestModal({
  entityType,
  entityId,
  entityLabel,
  isRestricted = false,
  onSuccess,
  onClose,
}: AccessRequestModalProps) {
  const { t, systemToken } = useTenantContext();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [targetTenant, setTargetTenant] = useState<
    { id: string; label: string }[]
  >([]);
  const [permissions, setPermissions] = useState<string[]>(["r"]);

  const togglePermission = (p: string) => {
    setPermissions((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  };

  const searchTenants = async (search: string) => {
    if (!systemToken) return [];
    const params = new URLSearchParams({ limit: "20" });
    if (search) params.set("search", search);
    const res = await fetch(`/api/core/companies?${params}`, {
      headers: { Authorization: `Bearer ${systemToken}` },
    });
    const json = await res.json();
    const items = (json.items ?? json.data ?? []) as Record<string, unknown>[];
    return items.map((item) => ({
      id: String(item.id),
      label: String(item.name ?? item.id),
    }));
  };

  const handleSubmit = async () => {
    if (targetTenant.length === 0) {
      setError(t("access.targetTenant"));
      return;
    }
    if (isRestricted && permissions.length === 0) {
      setError(t("validation.fields.required"));
      return;
    }
    if (!systemToken) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/access-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({
          entityType,
          entityId,
          targetTenantId: targetTenant[0].id,
          permissions: isRestricted ? permissions : undefined,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        const msg = json.error?.errors?.map((e: string) => t(e)).join(", ") ??
          json.error?.message ?? "common.error.generic";
        setError(msg);
        return;
      }
      setSuccess(true);
      onSuccess();
    } catch {
      setError(t("common.error.network"));
    } finally {
      setLoading(false);
    }
  };

  const label = entityLabel ?? entityId;

  return (
    <Modal open onClose={onClose} title={t("access.requestTitle")}>
      <div className="space-y-4">
        {success
          ? (
            <div className="rounded-lg bg-[var(--color-primary-green)]/10 border border-[var(--color-primary-green)]/30 p-4 text-sm text-[var(--color-primary-green)]">
              {isRestricted ? t("access.shared") : t("access.pendingApproval")}
            </div>
          )
          : (
            <>
              <div>
                <label className="block text-xs text-[var(--color-light-text)] mb-1">
                  {t("access.entityType")}
                </label>
                <p className="text-sm text-white">{entityType}</p>
              </div>
              <div>
                <label className="block text-xs text-[var(--color-light-text)] mb-1">
                  {t("access.entityId")}
                </label>
                <p className="text-sm text-white">{label}</p>
              </div>

              <div>
                <label className="block text-xs text-[var(--color-light-text)] mb-1">
                  {t("access.targetTenant")}
                </label>
                <SearchableSelectField
                  fetchFn={searchTenants}
                  multiple={false}
                  onChange={setTargetTenant}
                  placeholder={t("access.targetTenant")}
                  showAllOnEmpty
                />
              </div>

              {isRestricted && (
                <div>
                  <label className="block text-xs text-[var(--color-light-text)] mb-1">
                    {t("access.permission")}
                  </label>
                  <div className="flex gap-3">
                    {(["r", "w", "share"] as const).map((p) => (
                      <label
                        key={p}
                        className="flex items-center gap-1.5 text-sm text-[var(--color-light-text)] cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={permissions.includes(p)}
                          onChange={() => togglePermission(p)}
                          className="accent-[var(--color-primary-green)]"
                        />
                        {t(
                          `access.permission.${
                            p === "r" ? "read" : p === "w" ? "write" : "share"
                          }`,
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {error && <p className="text-sm text-red-400">{error}</p>}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={onClose}
                  className="flex-1 rounded-lg border border-[var(--color-dark-gray)] px-4 py-2 text-sm text-[var(--color-light-text)] transition-colors hover:bg-white/5"
                >
                  {t("common.cancel")}
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={loading || targetTenant.length === 0}
                  className="flex-1 rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-4 py-2 text-sm font-semibold text-black transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading && (
                    <Spinner
                      size="sm"
                      className="border-black border-t-transparent"
                    />
                  )}
                  {t("access.requestSent")}
                </button>
              </div>
            </>
          )}

        {success && (
          <button
            onClick={onClose}
            className="w-full rounded-lg border border-[var(--color-dark-gray)] px-4 py-2 text-sm text-[var(--color-light-text)] transition-colors hover:bg-white/5 mt-4"
          >
            {t("common.close")}
          </button>
        )}
      </div>
    </Modal>
  );
}
