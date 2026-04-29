"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import GenericList from "@/src/components/shared/GenericList";
import EditButton from "@/src/components/shared/EditButton";
import DeleteButton from "@/src/components/shared/DeleteButton";
import Spinner from "@/src/components/shared/Spinner";
import Modal from "@/src/components/shared/Modal";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import PlanCard from "@/src/components/shared/PlanCard";
import PlanSubform from "@/src/components/subforms/PlanSubform";
import type { SubformRef } from "@/src/contracts/high_level/components";
import type {
  CursorParams,
  PaginatedResult,
} from "@/src/contracts/high_level/pagination";
import type { SystemOption } from "@/src/contracts/high_level/components";
import { useTenantContext } from "@/src/hooks/useTenantContext";

interface PlanItem {
  id: string;
  name: string;
  description: string;
  systemId: string;
  price: number;
  currency: string;
  recurrenceDays: number;
  resourceLimitId?: Record<string, unknown> | null;
  isActive: boolean;
  createdAt: string;
  [key: string]: unknown;
}

export default function PlansPage() {
  const { t } = useTenantContext();
  const { systemToken } = useTenantContext();
  const [systems, setSystems] = useState<SystemOption[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editItem, setEditItem] = useState<PlanItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  const formRef = useRef<SubformRef>(null);
  const [formInitial, setFormInitial] = useState<
    Record<string, unknown> | undefined
  >(undefined);

  const fetchPlans = useCallback(
    async (
      params: CursorParams & { search?: string },
    ): Promise<PaginatedResult<PlanItem>> => {
      const p = new URLSearchParams();
      if (params.search) p.set("search", params.search);
      if (params.cursor) p.set("cursor", params.cursor);
      p.set("limit", String(params.limit));
      const res = await fetch(`/api/core/plans?${p}`, {
        headers: { Authorization: `Bearer ${systemToken}` },
      });
      const json = await res.json();
      return {
        items: (json.items ?? []) as PlanItem[],
        total: json.total ?? 0,
        hasMore: json.hasMore ?? false,
        nextCursor: json.nextCursor,
      };
    },
    [systemToken],
  );

  const triggerReload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    if (!systemToken) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/core/systems?limit=200", {
          headers: { Authorization: `Bearer ${systemToken}` },
        });
        const json = await res.json();
        if (json.success && !cancelled) setSystems(json.items ?? []);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [systemToken]);

  const openCreate = () => {
    setFormInitial(undefined);
    setError(null);
    setShowCreate(true);
  };

  const openEdit = (item: PlanItem) => {
    setFormInitial({
      name: item.name ?? "",
      description: item.description ?? "",
      systemId: String(item.systemId ?? ""),
      price: item.price ?? 0,
      currency: item.currency ?? "USD",
      recurrenceDays: item.recurrenceDays ?? 30,
      isActive: item.isActive ?? true,
      ...(item.resourceLimitId as Record<string, unknown> ?? {}),
    });
    setError(null);
    setValidationErrors([]);
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
      const res = await fetch("/api/core/plans", {
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
    await fetch("/api/core/plans", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${systemToken}`,
      },
      body: JSON.stringify({ id }),
    });
    triggerReload();
  };

  const getSystemName = (sysId: string) => {
    const sys = systems.find((s) => s.id === sysId);
    return sys?.name ?? sysId;
  };

  const getSystemSlug = (sysId: string): string | undefined => {
    const sys = systems.find((s) => s.id === sysId);
    return sys?.slug;
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
        {t("core.plans.title")}
      </h1>

      <GenericList<PlanItem>
        entityName={t("core.plans.create")}
        searchEnabled
        createEnabled
        controlButtons={[]}
        onCreateClick={openCreate}
        fetchFn={fetchPlans}
        reloadKey={reloadKey}
        renderItem={(plan) => (
          <PlanCard
            plan={plan}
            variant="core"
            systemSlug={getSystemSlug(plan.systemId)}
            badges={
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                  plan.isActive
                    ? "bg-[var(--color-primary-green)]/20 text-[var(--color-primary-green)]"
                    : "bg-red-500/20 text-red-400"
                }`}
              >
                {plan.isActive
                  ? t("core.plans.active")
                  : t("core.plans.inactive")}
              </span>
            }
            actions={
              <div className="mt-4 flex gap-2 justify-end">
                <EditButton onClick={() => openEdit(plan)} />
                <DeleteButton onConfirm={() => handleDelete(plan.id)} />
              </div>
            }
            systemName={getSystemName(plan.systemId)}
          />
        )}
      />

      <Modal
        open={showCreate || !!editItem}
        onClose={() => {
          setShowCreate(false);
          setEditItem(null);
        }}
        title={editItem ? t("core.plans.edit") : t("core.plans.create")}
      >
        <ErrorDisplay message={error} errors={validationErrors} />
        <form onSubmit={handleSave} className="mt-4 space-y-4">
          <PlanSubform
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
