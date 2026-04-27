"use client";

import React from "react";
import GenericList from "@/src/components/shared/GenericList";
import TenantView from "@/src/components/shared/TenantView";
import type { CursorParams, PaginatedResult } from "@/src/contracts/common";
import FileAccessSubform from "@/src/components/subforms/FileAccessSubform";
import type { SubformConfig } from "@/src/components/shared/GenericList";
import type {
  FileAccessSection,
  FileAccessUploadSection,
} from "@/src/contracts/file-access";
import { useTenantContext } from "@/src/hooks/useTenantContext";

interface FileAccessItem {
  id: string;
  name: string;
  categoryPattern: string;
  download: FileAccessSection;
  upload: FileAccessUploadSection;
  createdAt: string;
  [key: string]: unknown;
}

const emptySection = (): FileAccessSection => ({
  isolateSystem: false,
  isolateCompany: false,
  isolateUser: false,
  roles: [],
});

const emptyUploadSection = (): FileAccessUploadSection => ({
  ...emptySection(),
  maxFileSizeMB: undefined,
  allowedExtensions: [],
});

const formSubforms: SubformConfig[] = [
  {
    component: React.forwardRef<
      import("@/src/components/shared/GenericList").SubformRef,
      { initialData?: Record<string, unknown> }
    >((props, ref) => <FileAccessSubform ref={ref} {...props} />),
    key: "fileAccess",
  },
];

function createFetchFileAccess(token: string) {
  return async function fetchFileAccess(
    params: CursorParams & { search?: string },
  ): Promise<PaginatedResult<FileAccessItem>> {
    const qs = new URLSearchParams();
    if (params.search) qs.set("search", params.search);
    if (params.cursor) qs.set("cursor", params.cursor);
    qs.set("limit", String(params.limit));
    const res = await fetch(`/api/core/file-access?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    return {
      items: json.items ?? [],
      total: json.total ?? 0,
      hasMore: json.hasMore ?? false,
      nextCursor: json.nextCursor,
    };
  };
}

export default function FileAccessPage() {
  const { t } = useTenantContext();
  const { systemToken } = useTenantContext();

  const ISOLATION_FIELDS = [
    "isolateSystem",
    "isolateCompany",
    "isolateUser",
  ] as const;

  const renderItem = (item: FileAccessItem, controls: React.ReactNode) => {
    const upload = item.upload ?? emptyUploadSection();

    return (
      <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-4 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 transition-all">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl">📂</span>
            <div>
              <h3 className="font-semibold text-white text-lg">
                {t(item.name)}
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
            const sec = (item[op] ?? (op === "upload"
              ? emptyUploadSection()
              : emptySection())) as FileAccessSection;
            const anyIsolation = sec.isolateSystem || sec.isolateCompany ||
              sec.isolateUser;
            return (
              <div key={op}>
                <span className="text-sm font-medium text-[var(--color-light-text)]">
                  {t(`core.fileAccess.${op}`)}:
                </span>
                {anyIsolation
                  ? (
                    <TenantView
                      tenant={{
                        id: `${item.id}-${op}`,
                        isolateSystem: sec.isolateSystem,
                        isolateCompany: sec.isolateCompany,
                        isolateUser: sec.isolateUser,
                        roles: sec.roles,
                      }}
                      visibleFields={[...ISOLATION_FIELDS, "roles"]}
                      compact
                    />
                  )
                  : (
                    <div className="mt-1">
                      <span className="rounded-full bg-[var(--color-primary-green)]/20 px-2 py-0.5 text-xs text-[var(--color-primary-green)]">
                        {t("core.fileAccess.anonymous")}
                      </span>
                    </div>
                  )}
              </div>
            );
          })}
        </div>

        {upload &&
          (upload.maxFileSizeMB !== undefined ||
            upload.allowedExtensions?.length > 0) &&
          (
            <div className="mt-3 pt-3 border-t border-[var(--color-dark-gray)]/50 flex flex-wrap gap-3 text-sm">
              {upload.maxFileSizeMB !== undefined && (
                <span className="flex items-center gap-1">
                  <span className="text-[var(--color-light-text)]">📏</span>
                  <span className="text-[var(--color-light-text)]">
                    {t("core.fileAccess.maxFileSizeMB")}:
                  </span>{" "}
                  <span className="text-white">{upload.maxFileSizeMB} MB</span>
                </span>
              )}
              {upload.allowedExtensions?.length > 0 && (
                <span className="flex items-center gap-1 flex-wrap">
                  <span className="text-[var(--color-light-text)]">📎</span>
                  <span className="text-[var(--color-light-text)]">
                    {t("core.fileAccess.allowedExtensions")}:
                  </span>{" "}
                  {upload.allowedExtensions.map((ext) => (
                    <span
                      key={ext}
                      className="rounded-full bg-[var(--color-secondary-blue)]/15 px-2 py-0.5 text-xs text-[var(--color-secondary-blue)]"
                    >
                      .{ext}
                    </span>
                  ))}
                </span>
              )}
            </div>
          )}
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
        fetchFn={createFetchFileAccess(systemToken ?? "")}
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
