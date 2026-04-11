"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/src/hooks/useLocale";
import { useAuth } from "@/src/hooks/useAuth";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import Modal from "@/src/components/shared/Modal";

interface SystemTerms {
  id: string;
  name: string;
  slug: string;
  termsOfService: string | null;
  hasCustomTerms: boolean;
  effectiveTerms: string;
}

interface TermsData {
  generic: string;
  systems: SystemTerms[];
}

export default function TermsEditor() {
  const { t } = useLocale();
  const { systemToken } = useAuth();

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
  const [systemSearch, setSystemSearch] = useState("");
  const [systemResults, setSystemResults] = useState<SystemTerms[]>([]);
  const [searchingSystem, setSearchingSystem] = useState(false);
  const [selectedSystem, setSelectedSystem] = useState<SystemTerms | null>(
    null,
  );
  const [addTermsContent, setAddTermsContent] = useState("");
  const systemDebounceRef = useRef<ReturnType<typeof setTimeout>>(null);

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
    setSystemSearch("");
    setSystemResults([]);
    setAddTermsContent("");
    setError(null);
    setSuccess(null);
    setShowAddModal(true);
  };

  const searchSystems = useCallback(
    (query: string) => {
      setSystemSearch(query);
      if (systemDebounceRef.current) clearTimeout(systemDebounceRef.current);
      if (!query.trim()) {
        setSystemResults([]);
        return;
      }
      systemDebounceRef.current = setTimeout(async () => {
        setSearchingSystem(true);
        try {
          const res = await fetch(
            `/api/core/systems?search=${encodeURIComponent(query)}&limit=10`,
            { headers: { Authorization: `Bearer ${systemToken}` } },
          );
          const json = await res.json();
          setSystemResults(
            (json.data ?? []).map((
              s: {
                id: string;
                name: string;
                slug: string;
                termsOfService?: string;
              },
            ) => ({
              id: s.id,
              name: s.name,
              slug: s.slug,
              termsOfService: s.termsOfService ?? null,
              hasCustomTerms: !!s.termsOfService,
              effectiveTerms: s.termsOfService || data?.generic || "",
            })),
          );
        } catch {
          setSystemResults([]);
        } finally {
          setSearchingSystem(false);
        }
      }, 300);
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
              <button
                type="button"
                onClick={openEditGeneric}
                className="rounded-lg border border-[var(--color-dark-gray)] px-3 py-1.5 text-sm text-[var(--color-light-text)] hover:bg-white/5 transition-colors"
              >
                ✏️ {t("core.terms.editGeneric")}
              </button>
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
                      href={`/terms?system=${encodeURIComponent(sys.slug)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg border border-[var(--color-dark-gray)] px-3 py-1.5 text-sm text-[var(--color-light-text)] hover:bg-white/5 transition-colors"
                    >
                      🔗 {t("core.terms.viewPublic")}
                    </a>
                    <button
                      type="button"
                      onClick={() => openEditSystem(sys)}
                      className="rounded-lg border border-[var(--color-dark-gray)] px-3 py-1.5 text-sm text-[var(--color-light-text)] hover:bg-white/5 transition-colors"
                    >
                      ✏️ {t("core.terms.editTerms")}
                    </button>
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
              placeholder="<p>Terms of service HTML content...</p>"
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
          <div className="backdrop-blur-md bg-white/5 border border-[var(--color-dark-gray)] rounded-lg p-3">
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
              placeholder="<p>Terms of service HTML content...</p>"
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
          {selectedSystem
            ? (
              <div className="flex items-center gap-3 backdrop-blur-md bg-white/5 border border-[var(--color-dark-gray)] rounded-lg p-3">
                <span className="text-sm text-white font-medium">
                  {selectedSystem.name}
                </span>
                <span className="text-xs text-[var(--color-light-text)]/60">
                  {selectedSystem.slug}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSystem(null);
                    setSystemSearch("");
                  }}
                  className="ml-auto text-xs text-red-400 hover:text-red-300"
                >
                  ✕
                </button>
              </div>
            )
            : (
              <div className="relative">
                <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
                  {t("core.terms.selectSystem")}
                </label>
                <input
                  type="text"
                  value={systemSearch}
                  onChange={(e) => searchSystems(e.target.value)}
                  placeholder={t("core.terms.selectSystem")}
                  className={inputCls}
                />
                {searchingSystem && (
                  <div className="absolute right-3 top-[2.1rem]">
                    <Spinner size="sm" />
                  </div>
                )}
                {systemResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-lg border border-[var(--color-dark-gray)] bg-[#111]/95 backdrop-blur-md shadow-lg max-h-48 overflow-y-auto">
                    {systemResults.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setSelectedSystem(s);
                          setSystemResults([]);
                          setSystemSearch("");
                          setAddTermsContent(s.termsOfService ?? "");
                        }}
                        className="w-full text-left px-4 py-2.5 text-sm text-white hover:bg-white/5 transition-colors"
                      >
                        {s.name}{" "}
                        <span className="text-xs text-[var(--color-light-text)]/60">
                          {s.slug}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

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
              placeholder="<p>Terms of service HTML content...</p>"
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
