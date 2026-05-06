"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import Modal from "@/src/components/shared/Modal";
import EditButton from "@/src/components/shared/EditButton";
import SearchableSelectField from "@/src/components/fields/SearchableSelectField";
import { useTenantContext } from "@/src/hooks/useTenantContext";
import type { SystemTerms, TermsData } from "@/src/contracts/high-level/terms";

export default function TermsEditor() {
  const { t } = useTenantContext();
  const { systemToken } = useTenantContext();

  const [data, setData] = useState<TermsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Generic terms modal
  const [showGenericModal, setShowGenericModal] = useState(false);
  const [genericContent, setGenericContent] = useState("");

  // System terms modal
  const [showSystemModal, setShowSystemModal] = useState(false);
  const [editingSystem, setEditingSystem] = useState<SystemTerms | null>(null);
  const [systemTermsContent, setSystemTermsContent] = useState("");

  // System search for "add new" mode
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedSystem, setSelectedSystem] = useState<
    {
      id: string;
      name: string;
      slug: string;
    } | null
  >(null);
  const [addTermsContent, setAddTermsContent] = useState("");
  const systemsCacheRef = useRef<
    Map<
      string,
      { id: string; name: string; slug: string; termsOfService: string | null }
    >
  >(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/core/terms", {
        headers: { Authorization: `Bearer ${systemToken}` },
      });
      const json = await res.json();
      if (json.success) setData(json.data);
    } finally {
      setLoading(false);
    }
  }, [systemToken]);

  useEffect(() => {
    load();
  }, [load]);

  const saveGeneric = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/core/terms", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({ generic: true, content: genericContent }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error?.message ?? "common.error.generic");
        return;
      }
      setSuccess(t("core.terms.saved"));
      setShowGenericModal(false);
      load();
    } catch {
      setError("common.error.network");
    } finally {
      setSaving(false);
    }
  };

  const saveSystemTerms = async (systemId: string, content: string) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/core/terms", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({ systemId, termsOfService: content }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error?.message ?? "common.error.generic");
        return;
      }
      setSuccess(t("core.terms.saved"));
      setShowSystemModal(false);
      setShowAddModal(false);
      setEditingSystem(null);
      setSelectedSystem(null);
      load();
    } catch {
      setError("common.error.network");
    } finally {
      setSaving(false);
    }
  };

  const openEditGeneric = () => {
    setGenericContent(data?.generic ?? "");
    setError(null);
    setSuccess(null);
    setShowGenericModal(true);
  };

  const openEditSystem = (sys: SystemTerms) => {
    setEditingSystem(sys);
    setSystemTermsContent(sys.termsOfService ?? "");
    setError(null);
    setSuccess(null);
    setShowSystemModal(true);
  };

  const openAddSystem = () => {
    setSelectedSystem(null);
    setAddTermsContent("");
    setError(null);
    setSuccess(null);
    setShowAddModal(true);
  };

  const systemFetchFn = useCallback(
    async (search: string): Promise<{ id: string; label: string }[]> => {
      const res = await fetch(
        `/api/core/systems?search=${encodeURIComponent(search)}&limit=10`,
        { headers: { Authorization: `Bearer ${systemToken}` } },
      );
      const json = await res.json();
      const items: { id: string; label: string }[] = [];
      for (const s of json.items ?? []) {
        systemsCacheRef.current.set(s.id, {
          id: s.id,
          name: s.name,
          slug: s.slug,
          termsOfService: s.termsOfService ?? null,
        });
        items.push({ id: s.id, label: s.name });
      }
      return items;
    },
    [systemToken],
  );

  const inputCls =
    "w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white outline-none focus:border-[var(--color-primary-green)] transition-colors";

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent mb-6">
        {t("core.terms.title")}
      </h1>

      {success && (
        <div className="mb-4 p-3 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-sm">
          {success}
        </div>
      )}

      <div className="space-y-6">
        {/* Generic Terms Card */}
        <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-5 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 transition-all">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                📜 {t("core.terms.generic")}
              </h2>
              <p className="text-xs text-[var(--color-light-text)]/60 mt-1">
                {t("core.terms.genericHint")}
              </p>
            </div>
            <div className="flex gap-2">
              <EditButton onClick={openEditGeneric} />
            </div>
          </div>
          {data?.generic
            ? (
              <div className="mt-3 max-h-24 overflow-y-auto rounded-lg border border-[var(--color-dark-gray)] bg-white/5 p-3 text-xs text-[var(--color-light-text)]">
                <div dangerouslySetInnerHTML={{ __html: data.generic }} />
              </div>
            )
            : (
              <p className="mt-3 text-sm text-[var(--color-light-text)]/40 italic">
                {t("core.terms.notConfigured")}
              </p>
            )}
        </div>

        {/* Add System Terms Button */}
        <button
          type="button"
          onClick={openAddSystem}
          className="w-full rounded-lg border-2 border-dashed border-[var(--color-dark-gray)] px-4 py-3 text-sm text-[var(--color-light-text)] hover:border-[var(--color-primary-green)] hover:text-[var(--color-primary-green)] transition-colors"
        >
          + {t("core.terms.editTerms")}
        </button>

        {/* System Terms List */}
        {data?.systems && data.systems.length > 0
          ? (
            <div className="space-y-3">
              {data.systems.map((sys) => (
                <div
                  key={sys.id}
                  className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-4 flex items-center justify-between hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 transition-all"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <h3 className="font-semibold text-white">{sys.name}</h3>
                      <span className="text-xs text-[var(--color-light-text)]">
                        {sys.slug}
                      </span>
                      {sys.hasCustomTerms
                        ? (
                          <span className="inline-flex items-center rounded-full bg-green-500/10 border border-green-500/30 px-2 py-0.5 text-xs text-green-400">
                            {t("core.terms.hasTerms")}
                          </span>
                        )
                        : (
                          <span className="inline-flex items-center rounded-full bg-yellow-500/10 border border-yellow-500/30 px-2 py-0.5 text-xs text-yellow-400">
                            {t("core.terms.usingGeneric")}
                          </span>
                        )}
                    </div>
                    {sys.effectiveTerms
                      ? (
                        <div className="mt-2 max-h-16 overflow-y-auto rounded border border-[var(--color-dark-gray)] bg-white/5 p-2 text-xs text-[var(--color-light-text)]">
                          <div
                            dangerouslySetInnerHTML={{
                              __html: sys.effectiveTerms,
                            }}
                          />
                        </div>
                      )
                      : (
                        <p className="mt-2 text-xs text-[var(--color-light-text)]/40 italic">
                          {t("core.terms.noTerms")}
                        </p>
                      )}
                  </div>
                  <div className="flex gap-2 ml-4 shrink-0">
                    <a
                      href={`/terms?systemSlug=${encodeURIComponent(sys.slug)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg border border-[var(--color-dark-gray)] px-3 py-1.5 text-sm text-[var(--color-light-text)] hover:bg-white/5 transition-colors"
                    >
                      🔗 {t("core.terms.viewPublic")}
                    </a>
                    <EditButton onClick={() => openEditSystem(sys)} />
                  </div>
                </div>
              ))}
            </div>
          )
          : (
            <p className="text-center py-8 text-[var(--color-light-text)]">
              {t("core.terms.empty")}
            </p>
          )}
      </div>

      {/* Generic Terms Modal */}
      <Modal
        open={showGenericModal}
        onClose={() => setShowGenericModal(false)}
        title={t("core.terms.editGeneric")}
      >
        <div className="space-y-4">
          <ErrorDisplay message={error} />
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.terms.content")}
            </label>
            <p className="text-xs text-[var(--color-light-text)]/60 mb-2">
              {t("core.terms.contentHint")}
            </p>
            <textarea
              value={genericContent}
              onChange={(e) => setGenericContent(e.target.value)}
              rows={16}
              className={inputCls}
              placeholder={t("core.terms.placeholder.content")}
            />
          </div>
          <button
            type="button"
            onClick={saveGeneric}
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
            {t("core.terms.save")}
          </button>
        </div>
      </Modal>

      {/* Edit System Terms Modal */}
      <Modal
        open={showSystemModal}
        onClose={() => {
          setShowSystemModal(false);
          setEditingSystem(null);
        }}
        title={`${t("core.terms.editTerms")} — ${editingSystem?.name ?? ""}`}
      >
        <div className="space-y-4">
          <ErrorDisplay message={error} />
          <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-lg p-3">
            <span className="text-sm text-[var(--color-light-text)]">
              {editingSystem?.name}
            </span>
            <span className="ml-2 text-xs text-[var(--color-light-text)]/60">
              {editingSystem?.slug}
            </span>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.terms.content")}
            </label>
            <p className="text-xs text-[var(--color-light-text)]/60 mb-2">
              {t("core.terms.contentHint")}
            </p>
            <textarea
              value={systemTermsContent}
              onChange={(e) => setSystemTermsContent(e.target.value)}
              rows={16}
              className={inputCls}
              placeholder={t("core.terms.placeholder.content")}
            />
          </div>
          <button
            type="button"
            onClick={() =>
              editingSystem &&
              saveSystemTerms(editingSystem.id, systemTermsContent)}
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
            {t("core.terms.save")}
          </button>
        </div>
      </Modal>

      {/* Add System Terms Modal (with search) */}
      <Modal
        open={showAddModal}
        onClose={() => {
          setShowAddModal(false);
          setSelectedSystem(null);
        }}
        title={t("core.terms.systemTerms")}
      >
        <div className="space-y-4">
          <ErrorDisplay message={error} />

          {/* System Search */}
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.terms.selectSystem")}
            </label>
            <SearchableSelectField
              key={selectedSystem?.id ?? "none"}
              fetchFn={systemFetchFn}
              onChange={(items) => {
                if (items.length > 0) {
                  const cached = systemsCacheRef.current.get(items[0].id);
                  if (cached) {
                    setSelectedSystem({
                      id: cached.id,
                      name: cached.name,
                      slug: cached.slug,
                    });
                    setAddTermsContent(cached.termsOfService ?? "");
                  }
                } else {
                  setSelectedSystem(null);
                }
              }}
              placeholder={t("core.terms.selectSystem")}
            />
          </div>

          {/* Terms Textarea */}
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("core.terms.content")}
            </label>
            <p className="text-xs text-[var(--color-light-text)]/60 mb-2">
              {t("core.terms.contentHint")}
            </p>
            <textarea
              value={addTermsContent}
              onChange={(e) => setAddTermsContent(e.target.value)}
              rows={16}
              className={inputCls}
              placeholder={t("core.terms.placeholder.content")}
            />
          </div>

          <button
            type="button"
            onClick={() =>
              selectedSystem &&
              saveSystemTerms(selectedSystem.id, addTermsContent)}
            disabled={saving || !selectedSystem}
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
            {t("core.terms.save")}
          </button>
        </div>
      </Modal>
    </div>
  );
}
