"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/src/hooks/useLocale";
import Spinner from "@/src/components/shared/Spinner";
import SearchField from "@/src/components/shared/SearchField";
import CreateButton from "@/src/components/shared/CreateButton";
import EditButton from "@/src/components/shared/EditButton";
import DeleteButton from "@/src/components/shared/DeleteButton";
import Modal from "@/src/components/shared/Modal";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import MultiBadgeField from "@/src/components/fields/MultiBadgeField";

interface FileAccessSection {
  isolateSystem: boolean;
  isolateCompany: boolean;
  isolateUser: boolean;
  permissions: string[];
}

interface FileAccessItem {
  id: string;
  name: string;
  categoryPattern: string;
  download: FileAccessSection;
  upload: FileAccessSection;
  createdAt: string;
}

const emptySection = (): FileAccessSection => ({
  isolateSystem: false,
  isolateCompany: false,
  isolateUser: false,
  permissions: [],
});

function IsolationBadge({ label, on }: { label: string; on: boolean }) {
  if (!on) return null;
  return (
    <span className="rounded-full bg-[var(--color-secondary-blue)]/20 px-2 py-0.5 text-xs text-[var(--color-secondary-blue)]">
      {label}
    </span>
  );
}

function SectionEditor({
  title,
  section,
  onChange,
  t,
}: {
  title: string;
  section: FileAccessSection;
  onChange: (s: FileAccessSection) => void;
  t: (key: string) => string;
}) {
  const toggleCls = (on: boolean) =>
    `relative w-10 h-5 rounded-full transition-colors cursor-pointer ${
      on ? "bg-[var(--color-primary-green)]" : "bg-white/10"
    }`;
  const dotCls = (on: boolean) =>
    `absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
      on ? "left-5" : "left-0.5"
    }`;

  return (
    <div className="space-y-3 p-4 rounded-lg border border-[var(--color-dark-gray)] bg-white/[0.02]">
      <h3 className="text-sm font-semibold text-[var(--color-light-text)] uppercase tracking-wider">
        {title}
      </h3>
      <div className="flex flex-wrap gap-4">
        {(["isolateSystem", "isolateCompany", "isolateUser"] as const).map(
          (key) => {
            const labelKey = `core.fileAccess.${
              key === "isolateSystem"
                ? "isolateSystem"
                : key === "isolateCompany"
                ? "isolateCompany"
                : "isolateUser"
            }`;
            return (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <div
                  className={toggleCls(section[key])}
                  onClick={() => onChange({ ...section, [key]: !section[key] })}
                >
                  <div className={dotCls(section[key])} />
                </div>
                <span className="text-sm text-white">{t(labelKey)}</span>
              </label>
            );
          },
        )}
      </div>
      <MultiBadgeField
        name={t("core.fileAccess.permissions")}
        mode="custom"
        value={section.permissions}
        onChange={(vals) =>
          onChange({ ...section, permissions: vals as string[] })
        }
      />
    </div>
  );
}

export default function FileAccessPage() {
  const { t } = useLocale();
  const [items, setItems] = useState<FileAccessItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editItem, setEditItem] = useState<FileAccessItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Form fields
  const [formName, setFormName] = useState("");
  const [formPattern, setFormPattern] = useState("");
  const [formDownload, setFormDownload] = useState<FileAccessSection>(emptySection());
  const [formUpload, setFormUpload] = useState<FileAccessSection>(emptySection());

  const load = useCallback(async (q?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("search", q);
      const res = await fetch(`/api/core/file-access?${params}`);
      const json = await res.json();
      if (json.success) setItems(json.data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSearch = useCallback((q: string) => {
    setSearch(q);
    load(q);
  }, [load]);

  const openCreate = () => {
    setFormName("");
    setFormPattern("");
    setFormDownload(emptySection());
    setFormUpload(emptySection());
    setError(null);
    setShowCreate(true);
  };

  const openEdit = (item: FileAccessItem) => {
    setFormName(item.name);
    setFormPattern(item.categoryPattern);
    setFormDownload(item.download ?? emptySection());
    setFormUpload(item.upload ?? emptySection());
    setError(null);
    setEditItem(item);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setValidationErrors([]);
    try {
      const payload = {
        id: editItem?.id,
        name: formName,
        categoryPattern: formPattern,
        download: formDownload,
        upload: formUpload,
      };

      const method = editItem ? "PUT" : "POST";
      const res = await fetch("/api/core/file-access", {
        method,
        headers: { "Content-Type": "application/json" },
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
      load(search);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await fetch("/api/core/file-access", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    load(search);
  };

  const inputCls =
    "w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
        {t("core.fileAccess.title")}
      </h1>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-48">
          <SearchField onSearch={handleSearch} />
        </div>
        <CreateButton
          onClick={openCreate}
          label={t("core.fileAccess.create")}
        />
      </div>

      {loading
        ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        )
        : items.length === 0
        ? (
          <p className="text-center py-12 text-[var(--color-light-text)]">
            {t("core.fileAccess.empty")}
          </p>
        )
        : (
          <div className="space-y-3">
            {items.map((item) => (
              <div
                key={item.id}
                className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-4 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 transition-all"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">📂</span>
                    <div>
                      <h3 className="font-semibold text-white text-lg">
                        {item.name}
                      </h3>
                      <p className="font-mono text-sm text-[var(--color-light-text)] mt-0.5">
                        {item.categoryPattern}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 ml-3 shrink-0">
                    <EditButton onClick={() => openEdit(item)} />
                    <DeleteButton onConfirm={() => handleDelete(item.id)} />
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(["download", "upload"] as const).map((op) => {
                    const sec = item[op] ?? emptySection();
                    const anyIsolation = sec.isolateSystem || sec.isolateCompany || sec.isolateUser;
                    return (
                      <div key={op} className="text-sm">
                        <span className="font-medium text-[var(--color-light-text)]">
                          {t(`core.fileAccess.${op}`)}:
                        </span>{" "}
                        {anyIsolation ? (
                          <span className="inline-flex gap-1 flex-wrap">
                            <IsolationBadge label={t("core.fileAccess.isolateSystem")} on={sec.isolateSystem} />
                            <IsolationBadge label={t("core.fileAccess.isolateCompany")} on={sec.isolateCompany} />
                            <IsolationBadge label={t("core.fileAccess.isolateUser")} on={sec.isolateUser} />
                          </span>
                        ) : (
                          <span className="rounded-full bg-[var(--color-primary-green)]/20 px-2 py-0.5 text-xs text-[var(--color-primary-green)]">
                            Anonymous
                          </span>
                        )}
                        {sec.permissions.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {sec.permissions.map((p) => (
                              <span
                                key={p}
                                className="rounded-full bg-[var(--color-primary-green)]/15 px-2 py-0.5 text-xs text-[var(--color-primary-green)]"
                              >
                                {p}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

      {/* Create/Edit Modal */}
      <Modal
        open={showCreate || !!editItem}
        onClose={() => {
          setShowCreate(false);
          setEditItem(null);
        }}
        title={editItem ? t("core.fileAccess.edit") : t("core.fileAccess.create")}
      >
        <ErrorDisplay message={error} errors={validationErrors} />
        <form onSubmit={handleSave} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.fileAccess.name")} *
            </label>
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              required
              placeholder={t("core.fileAccess.placeholder.name")}
              className={inputCls}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.fileAccess.categoryPattern")} *
            </label>
            <input
              type="text"
              value={formPattern}
              onChange={(e) => setFormPattern(e.target.value)}
              required
              placeholder={t("core.fileAccess.placeholder.categoryPattern")}
              className={inputCls}
            />
            <p className="mt-1 text-xs text-[var(--color-light-text)]/60">
              {t("core.fileAccess.categoryPatternHint")}
            </p>
          </div>

          <p className="text-xs text-[var(--color-light-text)]/60">
            {t("core.fileAccess.isolationHint")}
          </p>

          <SectionEditor
            title={t("core.fileAccess.download")}
            section={formDownload}
            onChange={setFormDownload}
            t={t}
          />

          <SectionEditor
            title={t("core.fileAccess.upload")}
            section={formUpload}
            onChange={setFormUpload}
            t={t}
          />

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
