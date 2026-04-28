"use client";

import { useCallback, useState } from "react";
import GenericList from "@/src/components/shared/GenericList";
import Modal from "@/src/components/shared/Modal";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import EditButton from "@/src/components/shared/EditButton";
import DeleteButton from "@/src/components/shared/DeleteButton";
import FileUploadField from "@/src/components/fields/FileUploadField";
import type {
  CursorParams,
  PaginatedResult,
} from "@/src/contracts/high_level/pagination";
import { useTenantContext } from "@/src/hooks/useTenantContext";

interface SystemItem {
  id: string;
  name: string;
  slug: string;
  logoUri: string;
  createdAt: string;
  [key: string]: unknown;
}

export default function SystemsPage() {
  const { t } = useTenantContext();
  const { systemToken } = useTenantContext();
  const [showCreate, setShowCreate] = useState(false);
  const [editItem, setEditItem] = useState<SystemItem | null>(null);
  const [formName, setFormName] = useState("");
  const [formSlug, setFormSlug] = useState("");
  const [formLogo, setFormLogo] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  const fetchSystems = useCallback(
    async (
      params: CursorParams & { search?: string },
    ): Promise<PaginatedResult<SystemItem>> => {
      const p = new URLSearchParams();
      if (params.search) p.set("search", params.search);
      if (params.cursor) p.set("cursor", params.cursor);
      p.set("limit", String(params.limit));
      const res = await fetch(`/api/core/systems?${p}`, {
        headers: { Authorization: `Bearer ${systemToken}` },
      });
      const json = await res.json();
      return {
        items: (json.items ?? []) as SystemItem[],
        total: json.total ?? 0,
        hasMore: json.hasMore ?? false,
        nextCursor: json.nextCursor,
      };
    },
    [systemToken],
  );

  const triggerReload = () => setReloadKey((k) => k + 1);

  const openCreate = () => {
    setFormName("");
    setFormSlug("");
    setFormLogo("");
    setError(null);
    setShowCreate(true);
  };

  const openEdit = (item: SystemItem) => {
    setFormName(item.name);
    setFormSlug(item.slug);
    setFormLogo(item.logoUri);
    setError(null);
    setEditItem(item);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setValidationErrors([]);
    try {
      const isEdit = !!editItem;
      const method = isEdit ? "PUT" : "POST";
      const res = await fetch("/api/core/systems", {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({
          id: editItem?.id,
          name: formName,
          slug: formSlug,
          logoUri: formLogo,
        }),
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
    await fetch("/api/core/systems", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${systemToken}`,
      },
      body: JSON.stringify({ id }),
    });
    triggerReload();
  };

  const inputCls =
    "w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
        {t("core.systems.title")}
      </h1>

      <GenericList<SystemItem>
        entityName={t("core.systems.create")}
        searchEnabled
        createEnabled
        controlButtons={[]}
        onCreateClick={openCreate}
        fetchFn={fetchSystems}
        reloadKey={reloadKey}
        renderItem={(sys) => (
          <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-4 flex items-center justify-between hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 transition-all">
            <div className="flex items-center gap-4">
              {sys.logoUri
                ? (
                  <img
                    src={`/api/files/download?uri=${
                      encodeURIComponent(sys.logoUri)
                    }`}
                    alt={sys.name}
                    className="w-10 h-10 rounded"
                  />
                )
                : (
                  <div className="w-10 h-10 rounded bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] flex items-center justify-center text-black font-bold">
                    {sys.name[0]}
                  </div>
                )}
              <div>
                <h3 className="font-semibold text-white">{sys.name}</h3>
                <p className="text-sm text-[var(--color-light-text)]">
                  {sys.slug}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <EditButton onClick={() => openEdit(sys)} />
              <DeleteButton onConfirm={() => handleDelete(sys.id)} />
            </div>
          </div>
        )}
      />

      {/* Create/Edit Modal */}
      <Modal
        open={showCreate || !!editItem}
        onClose={() => {
          setShowCreate(false);
          setEditItem(null);
        }}
        title={editItem ? t("core.systems.edit") : t("core.systems.create")}
      >
        <ErrorDisplay message={error} errors={validationErrors} />
        <form onSubmit={handleSave} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.systems.name")} *
            </label>
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              required
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.systems.slug")} *
            </label>
            <input
              type="text"
              value={formSlug}
              onChange={(e) => setFormSlug(e.target.value)}
              required
              className={inputCls}
            />
          </div>
          {formSlug.trim()
            ? (
              <FileUploadField
                fieldName={t("core.systems.logo")}
                allowedExtensions={[".svg", ".png", ".jpg", ".jpeg", ".webp"]}
                maxSizeBytes={5242880}
                companyId="core"
                systemSlug={formSlug}
                category={["logos"]}
                previewEnabled
                currentUri={formLogo || undefined}
                onComplete={(uri) => setFormLogo(uri)}
                onRemove={() => setFormLogo("")}
              />
            )
            : (
              <p className="text-xs text-[var(--color-light-text)]/60">
                {t("core.systems.logoSlugRequired")}
              </p>
            )}
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-4 py-3 font-semibold text-black transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving
              ? (
                <Spinner
                  size="sm"
                  className="border-black border-t-transparent"
                />
              )
              : null}
            {t("common.save")}
          </button>
        </form>
      </Modal>
    </div>
  );
}
