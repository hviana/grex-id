"use client";

import { useCallback, useEffect, useState } from "react";
import Modal from "./Modal";
import Spinner from "./Spinner";
import { useTenantContext } from "@/src/hooks/useTenantContext";

interface ShareEntry {
  id: string;
  tenantId?: string;
  tenantLabel: string;
  permission?: string;
  isSelected: boolean;
}

interface RemoveAccessModalProps {
  entityType: string;
  entityId: string;
  entityLabel?: string;
  showPermission?: boolean;
  onSuccess: () => void;
  onClose: () => void;
}

export default function RemoveAccessModal({
  entityType,
  entityId,
  entityLabel,
  showPermission = false,
  onSuccess,
  onClose,
}: RemoveAccessModalProps) {
  const { t, systemToken } = useTenantContext();
  const [shares, setShares] = useState<ShareEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectAll, setSelectAll] = useState(false);

  const fetchShares = useCallback(async () => {
    if (!systemToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/access?entityType=${encodeURIComponent(entityType)}&entityId=${
          encodeURIComponent(entityId)
        }`,
        { headers: { Authorization: `Bearer ${systemToken}` } },
      );
      const json = await res.json();
      if (!json.success) {
        setError(
          json.error?.errors?.map((e: string) => t(e)).join(", ") ??
            json.error?.message ?? "common.error.generic",
        );
        return;
      }

      const items = (json.items ?? []) as Record<string, unknown>[];
      const entries: ShareEntry[] = items.map((item) => {
        const rawPermissions = item.permissions as string[] | undefined;
        const permLabel = rawPermissions?.length
          ? rawPermissions
            .map((p) =>
              t(`access.permission.${
                p === "r" ? "read" : p === "w" ? "write" : "share"
              }`)
            )
            .join(", ")
          : undefined;

        return {
          id: String(item.id),
          tenantId: String(item.tenantId ?? item.id),
          tenantLabel: String(
            item.companyId ?? item.accessesTenantIds ?? item.id,
          ),
          permission: permLabel,
          isSelected: false,
        };
      });

      setShares(entries);
    } catch {
      setError(t("common.error.network"));
    } finally {
      setLoading(false);
    }
  }, [systemToken, entityType, entityId, t, showPermission]);

  useEffect(() => {
    fetchShares();
  }, [fetchShares]);

  const toggleSelectAll = () => {
    const next = !selectAll;
    setSelectAll(next);
    setShares((prev) => prev.map((s) => ({ ...s, isSelected: next })));
  };

  const toggleOne = (id: string) => {
    setShares((prev) => {
      const next = prev.map((s) =>
        s.id === id ? { ...s, isSelected: !s.isSelected } : s
      );
      setSelectAll(next.every((s) => s.isSelected));
      return next;
    });
  };

  const handleRemove = async () => {
    const selected = shares.filter((s) => s.isSelected);
    if (selected.length === 0) return;
    if (!systemToken) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/access", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({
          entityType,
          entityId,
          shareIds: selected.map((s) => s.id),
          tenantIds: selected.map((s) => s.tenantId ?? s.id),
        }),
      });
      const json = await res.json();
      if (!json.success) {
        const msg = json.error?.errors?.map((e: string) => t(e)).join(", ") ??
          json.error?.message ?? "common.error.generic";
        setError(msg);
        return;
      }
      onSuccess();
    } catch {
      setError(t("common.error.network"));
    } finally {
      setSubmitting(false);
    }
  };

  const label = entityLabel ?? entityId;
  const selectedCount = shares.filter((s) => s.isSelected).length;

  return (
    <Modal open onClose={onClose} title={t("access.removeTitle")}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs text-[var(--color-light-text)] mb-1">
            {t("access.entityId")}
          </label>
          <p className="text-sm text-white">{label}</p>
        </div>

        {loading
          ? (
            <div className="flex justify-center py-8">
              <Spinner size="sm" />
            </div>
          )
          : shares.length === 0
          ? (
            <p className="text-sm text-[var(--color-light-text)]/60 text-center py-4">
              {t("access.noShares")}
            </p>
          )
          : (
            <>
              <label className="flex items-center gap-2 text-sm text-[var(--color-light-text)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectAll}
                  onChange={toggleSelectAll}
                  className="accent-[var(--color-primary-green)]"
                />
                {t("access.selectAll")}
              </label>

              <div className="max-h-60 overflow-y-auto space-y-1">
                {shares.map((share) => (
                  <label
                    key={share.id}
                    className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-white/5 cursor-pointer text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={share.isSelected}
                      onChange={() => toggleOne(share.id)}
                      className="accent-[var(--color-primary-green)]"
                    />
                    <span className="text-[var(--color-light-text)]">
                      {share.tenantLabel}
                    </span>
                  </label>
                ))}
              </div>
            </>
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
            onClick={handleRemove}
            disabled={submitting || selectedCount === 0}
            className="flex-1 rounded-lg bg-red-500/20 border border-red-500/30 px-4 py-2 text-sm font-semibold text-red-400 transition-all hover:bg-red-500/30 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting && (
              <Spinner
                size="sm"
                className="border-red-400 border-t-transparent"
              />
            )}
            {t("access.removed")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
