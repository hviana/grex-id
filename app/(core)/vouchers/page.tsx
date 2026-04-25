"use client";

import { useCallback, useRef, useState } from "react";
import type { CursorParams, PaginatedResult } from "@/src/contracts/common";
import { useLocale } from "@/src/hooks/useLocale";
import { useAuth } from "@/src/hooks/useAuth";
import GenericList from "@/src/components/shared/GenericList";
import Spinner from "@/src/components/shared/Spinner";
import Modal from "@/src/components/shared/Modal";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import VoucherCard from "@/src/components/core/VoucherCard";
import VoucherSubform from "@/src/components/subforms/VoucherSubform";
import type { SubformRef } from "@/src/components/shared/GenericList";

interface VoucherItem {
  id: string;
  code: string;
  applicableCompanies: string[];
  applicablePlans: string[];
  priceModifier: number;
  permissions: string[];
  entityLimitModifiers: Record<string, number> | null;
  apiRateLimitModifier: number;
  storageLimitModifier: number;
  fileCacheLimitModifier: number;
  maxConcurrentDownloadsModifier: number;
  maxConcurrentUploadsModifier: number;
  maxDownloadBandwidthModifier: number;
  maxUploadBandwidthModifier: number;
  maxOperationCountModifier: Record<string, number> | null;
  creditModifier: number;
  expiresAt: string | null;
  createdAt: string;
  [key: string]: unknown;
}

export default function VouchersPage() {
  const { t } = useLocale();
  const { systemToken } = useAuth();
  const [reloadKey, setReloadKey] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [editItem, setEditItem] = useState<VoucherItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const formRef = useRef<SubformRef>(null);
  const [formInitial, setFormInitial] = useState<
    Record<string, unknown> | undefined
  >(undefined);

  const triggerReload = () => setReloadKey((k) => k + 1);

  const fetchVouchers = useCallback(
    async (
      params: CursorParams & { search?: string },
    ): Promise<PaginatedResult<VoucherItem>> => {
      if (!systemToken) return { data: [], nextCursor: null, prevCursor: null };
      const query = new URLSearchParams();
      if (params.search) query.set("search", params.search);
      if (params.cursor) query.set("cursor", params.cursor);
      query.set("limit", String(params.limit));
      const res = await fetch(`/api/core/vouchers?${query}`, {
        headers: { Authorization: `Bearer ${systemToken}` },
      });
      const json = await res.json();
      if (json.success) {
        return {
          data: json.data ?? [],
          nextCursor: json.nextCursor ?? null,
          prevCursor: json.prevCursor ?? null,
        };
      }
      return { data: [], nextCursor: null, prevCursor: null };
    },
    [systemToken],
  );

  const openCreate = () => {
    setFormInitial(undefined);
    setError(null);
    setShowCreate(true);
  };

  const openEdit = (item: VoucherItem) => {
    setFormInitial({
      code: item.code,
      priceModifier: item.priceModifier,
      applicablePlans: item.applicablePlans ?? [],
      expiresAt: item.expiresAt,
      permissions: item.permissions ?? [],
      entityLimitModifiers: item.entityLimitModifiers,
      apiRateLimitModifier: item.apiRateLimitModifier ?? 0,
      storageLimitModifier: item.storageLimitModifier ?? 0,
      fileCacheLimitModifier: item.fileCacheLimitModifier ?? 0,
      creditModifier: item.creditModifier ?? 0,
      maxConcurrentDownloadsModifier: item.maxConcurrentDownloadsModifier ?? 0,
      maxConcurrentUploadsModifier: item.maxConcurrentUploadsModifier ?? 0,
      maxDownloadBandwidthModifier: item.maxDownloadBandwidthModifier ?? 0,
      maxUploadBandwidthModifier: item.maxUploadBandwidthModifier ?? 0,
      maxOperationCountModifier: item.maxOperationCountModifier,
    });
    setError(null);
    setEditItem(item);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setValidationErrors([]);
    try {
      const formData = formRef.current?.getData() ?? {};
      const payload = {
        id: editItem?.id,
        ...formData,
      };

      const method = editItem ? "PUT" : "POST";
      const res = await fetch("/api/core/vouchers", {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) {
        if (json.error?.errors) {
          setValidationErrors(json.error.errors);
        } else {
          setError(json.error?.message ?? "common.error.generic");
        }
        return;
      }
      setShowCreate(false);
      setEditItem(null);
      triggerReload();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await fetch("/api/core/vouchers", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${systemToken}`,
      },
      body: JSON.stringify({ id }),
    });
    triggerReload();
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
        {t("core.vouchers.title")}
      </h1>

      <GenericList<VoucherItem>
        entityName={t("core.vouchers.create")}
        controlButtons={[]}
        onCreateClick={openCreate}
        reloadKey={reloadKey}
        fetchFn={fetchVouchers}
        renderItem={(voucher) => (
          <VoucherCard
            voucher={voucher}
            onEdit={() => openEdit(voucher)}
            onDelete={() => handleDelete(voucher.id)}
          />
        )}
      />

      <Modal
        open={showCreate || !!editItem}
        onClose={() => {
          setShowCreate(false);
          setEditItem(null);
        }}
        title={editItem ? t("core.vouchers.edit") : t("core.vouchers.create")}
      >
        <ErrorDisplay message={error} errors={validationErrors} />
        <form onSubmit={handleSave} className="mt-4 space-y-4">
          <VoucherSubform
            ref={formRef}
            key={editItem?.id ?? "create"}
            initialData={formInitial}
          />

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-4 py-3 font-semibold text-black transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving && (
              <Spinner
                size="sm"
                className="border-black border-t-transparent"
              />
            )}
            {t("common.save")}
          </button>
        </form>
      </Modal>
    </div>
  );
}
