"use client";

import React from "react";
import { useLocale } from "@/src/hooks/useLocale";
import GenericList from "@/src/components/shared/GenericList";
import type { CursorParams, PaginatedResult } from "@/src/contracts/common";
import FileAccessSubform from "@/src/components/subforms/FileAccessSubform";
import type { SubformConfig } from "@/src/components/shared/GenericList";
import type { FileAccessSection } from "@/src/contracts/file-access";

interface FileAccessItem {
  id: string;
  name: string;
  categoryPattern: string;
  download: FileAccessSection;
  upload: FileAccessSection;
  createdAt: string;
  [key: string]: unknown;
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

const formSubforms: SubformConfig[] = [
  {
    component: React.forwardRef<
      import("@/src/components/shared/GenericList").SubformRef,
      { initialData?: Record<string, unknown> }
    >((props, ref) => <FileAccessSubform ref={ref} {...props} />),
    key: "fileAccess",
  },
];

async function fetchFileAccess(
  params: CursorParams & { search?: string },
): Promise<PaginatedResult<FileAccessItem>> {
  const qs = new URLSearchParams();
  if (params.search) qs.set("search", params.search);
  if (params.cursor) qs.set("cursor", params.cursor);
  qs.set("limit", String(params.limit));
  const res = await fetch(`/api/core/file-access?${qs}`);
  const json = await res.json();
  return {
    data: json.data ?? [],
    nextCursor: json.nextCursor ?? null,
    prevCursor: null,
  };
}

export default function FileAccessPage() {
  const { t } = useLocale();

  const renderItem = (item: FileAccessItem, controls: React.ReactNode) => {
    return (
      <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-4 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 transition-all">
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
            {controls}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(["download", "upload"] as const).map((op) => {
            const sec = (item[op] ?? emptySection()) as FileAccessSection;
            const anyIsolation = sec.isolateSystem || sec.isolateCompany ||
              sec.isolateUser;
            return (
              <div key={op} className="text-sm">
                <span className="font-medium text-[var(--color-light-text)]">
                  {t(`core.fileAccess.${op}`)}:
                </span>{" "}
                {anyIsolation
                  ? (
                    <span className="inline-flex gap-1 flex-wrap">
                      <IsolationBadge
                        label={t("core.fileAccess.isolateSystem")}
                        on={sec.isolateSystem}
                      />
                      <IsolationBadge
                        label={t("core.fileAccess.isolateCompany")}
                        on={sec.isolateCompany}
                      />
                      <IsolationBadge
                        label={t("core.fileAccess.isolateUser")}
                        on={sec.isolateUser}
                      />
                    </span>
                  )
                  : (
                    <span className="rounded-full bg-[var(--color-primary-green)]/20 px-2 py-0.5 text-xs text-[var(--color-primary-green)]">
                      {t("core.fileAccess.anonymous")}
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
    );
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
        {t("core.fileAccess.title")}
      </h1>

      <GenericList<FileAccessItem>
        entityName={t("core.fileAccess.create")}
        fetchFn={fetchFileAccess}
        renderItem={renderItem}
        createRoute="/api/core/file-access"
        editRoute={() => "/api/core/file-access"}
        deleteRoute={(id) =>
          `/api/core/file-access?id=${encodeURIComponent(id)}`}
        formSubforms={formSubforms}
      />
    </div>
  );
}
