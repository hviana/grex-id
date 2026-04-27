"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import type { SubformRef } from "@/src/components/shared/GenericList";
import type {
  FileAccessSection,
  FileAccessUploadSection,
} from "@/src/contracts/file-access";
import MultiBadgeField from "@/src/components/fields/MultiBadgeField";
import TenantSubform from "@/src/components/subforms/TenantSubform";
import { useTenantContext } from "@/src/hooks/useTenantContext";

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

function normalizeSection(
  raw: Record<string, unknown> | undefined,
): FileAccessSection {
  if (!raw) return emptySection();
  return {
    isolateSystem: !!raw.isolateSystem,
    isolateCompany: !!raw.isolateCompany,
    isolateUser: !!raw.isolateUser,
    roles: Array.isArray(raw.roles) ? raw.roles : [],
  };
}

function normalizeUploadSection(
  raw: Record<string, unknown> | undefined,
): FileAccessUploadSection {
  if (!raw) return emptyUploadSection();
  return {
    ...normalizeSection(raw),
    maxFileSizeMB: raw.maxFileSizeMB !== undefined && raw.maxFileSizeMB !== null
      ? Number(raw.maxFileSizeMB)
      : undefined,
    allowedExtensions: Array.isArray(raw.allowedExtensions)
      ? raw.allowedExtensions.map(String)
      : [],
  };
}

const ISOLATION_FIELDS = [
  "isolateSystem",
  "isolateCompany",
  "isolateUser",
] as const;

const FileAccessSubform = forwardRef<
  SubformRef,
  { initialData?: Record<string, unknown> }
>(({ initialData }, ref) => {
  const { t } = useTenantContext();

  const [name, setName] = useState((initialData?.name as string) ?? "");
  const [categoryPattern, setCategoryPattern] = useState(
    (initialData?.categoryPattern as string) ?? "",
  );
  const [download] = useState<FileAccessSection>(
    normalizeSection(
      initialData?.download as Record<string, unknown> | undefined,
    ),
  );
  const [upload, setUpload] = useState<FileAccessUploadSection>(
    normalizeUploadSection(
      initialData?.upload as Record<string, unknown> | undefined,
    ),
  );

  const downloadTenantRef = useRef<SubformRef>(null);
  const uploadTenantRef = useRef<SubformRef>(null);

  useImperativeHandle(ref, () => ({
    getData: () => {
      const dlTenant = downloadTenantRef.current?.getData() ?? {};
      const ulTenant = uploadTenantRef.current?.getData() ?? {};

      const downloadSection: FileAccessSection = {
        isolateSystem: !!dlTenant.isolateSystem,
        isolateCompany: !!dlTenant.isolateCompany,
        isolateUser: !!dlTenant.isolateUser,
        roles: Array.isArray(dlTenant.roles) ? dlTenant.roles : download.roles,
      };

      const uploadSection: FileAccessUploadSection = {
        isolateSystem: !!ulTenant.isolateSystem,
        isolateCompany: !!ulTenant.isolateCompany,
        isolateUser: !!ulTenant.isolateUser,
        roles: Array.isArray(ulTenant.roles) ? ulTenant.roles : upload.roles,
        maxFileSizeMB: upload.maxFileSizeMB,
        allowedExtensions: upload.allowedExtensions,
      };

      return {
        name,
        categoryPattern,
        download: downloadSection,
        upload: uploadSection,
      };
    },
    isValid: () => !!name.trim() && !!categoryPattern.trim(),
  }));

  const inputCls =
    "w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors";

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
          {t("core.fileAccess.name")} *
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
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
          value={categoryPattern}
          onChange={(e) => setCategoryPattern(e.target.value)}
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

      <div className="space-y-3 p-4 rounded-lg border border-[var(--color-dark-gray)] bg-white/[0.02]">
        <h3 className="text-sm font-semibold text-[var(--color-light-text)] uppercase tracking-wider">
          {t("core.fileAccess.download")}
        </h3>
        <TenantSubform
          ref={downloadTenantRef}
          visibleFields={[...ISOLATION_FIELDS, "roles"]}
          initialData={{
            isolateSystem: download.isolateSystem,
            isolateCompany: download.isolateCompany,
            isolateUser: download.isolateUser,
            roles: download.roles,
          }}
        />
      </div>

      <div className="space-y-3 p-4 rounded-lg border border-[var(--color-dark-gray)] bg-white/[0.02]">
        <h3 className="text-sm font-semibold text-[var(--color-light-text)] uppercase tracking-wider">
          {t("core.fileAccess.upload")}
        </h3>
        <TenantSubform
          ref={uploadTenantRef}
          visibleFields={[...ISOLATION_FIELDS, "roles"]}
          initialData={{
            isolateSystem: upload.isolateSystem,
            isolateCompany: upload.isolateCompany,
            isolateUser: upload.isolateUser,
            roles: upload.roles,
          }}
        />

        <div>
          <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
            {t("core.fileAccess.maxFileSizeMB")}
          </label>
          <input
            type="number"
            step="0.1"
            min="0"
            value={upload.maxFileSizeMB ?? ""}
            onChange={(e) => {
              const val = e.target.value;
              setUpload({
                ...upload,
                maxFileSizeMB: val === "" ? undefined : parseFloat(val),
              });
            }}
            placeholder={t("core.fileAccess.placeholder.maxFileSizeMB")}
            className={inputCls}
          />
          <p className="mt-1 text-xs text-[var(--color-light-text)]/60">
            {t("core.fileAccess.maxFileSizeMBHint")}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
            {t("core.fileAccess.allowedExtensions")}
          </label>
          <MultiBadgeField
            name={t("core.fileAccess.allowedExtensions")}
            mode="custom"
            value={upload.allowedExtensions}
            onChange={(vals) =>
              setUpload({
                ...upload,
                allowedExtensions: vals as string[],
              })}
            formatHint={t("core.fileAccess.allowedExtensionsHint")}
          />
        </div>
      </div>
    </div>
  );
});

FileAccessSubform.displayName = "FileAccessSubform";
export default FileAccessSubform;
