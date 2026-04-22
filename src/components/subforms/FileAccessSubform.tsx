"use client";

import { forwardRef, useImperativeHandle, useState } from "react";
import { useLocale } from "@/src/hooks/useLocale";
import type { SubformRef } from "@/src/components/shared/GenericList";
import type {
  FileAccessSection,
  FileAccessUploadSection,
} from "@/src/contracts/file-access";
import MultiBadgeField from "@/src/components/fields/MultiBadgeField";
import TranslatedBadge from "@/src/components/shared/TranslatedBadge";

const emptySection = (): FileAccessSection => ({
  isolateSystem: false,
  isolateCompany: false,
  isolateUser: false,
  permissions: [],
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
    permissions: Array.isArray(raw.permissions) ? raw.permissions : [],
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
            const labelKey = `core.fileAccess.${key}`;
            return (
              <label
                key={key}
                className="flex items-center gap-2 cursor-pointer"
              >
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
          onChange({ ...section, permissions: vals as string[] })}
        formatHint={t("core.fileAccess.permissionsHint")}
        renderBadge={(item, remove) => (
          <TranslatedBadge
            kind="permission"
            token={typeof item === "string" ? item : item.name}
            onRemove={remove}
          />
        )}
      />
    </div>
  );
}

function UploadSectionEditor({
  section,
  onChange,
  t,
}: {
  section: FileAccessUploadSection;
  onChange: (s: FileAccessUploadSection) => void;
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
        {t("core.fileAccess.upload")}
      </h3>
      <div className="flex flex-wrap gap-4">
        {(["isolateSystem", "isolateCompany", "isolateUser"] as const).map(
          (key) => {
            const labelKey = `core.fileAccess.${key}`;
            return (
              <label
                key={key}
                className="flex items-center gap-2 cursor-pointer"
              >
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
          onChange({ ...section, permissions: vals as string[] })}
        formatHint={t("core.fileAccess.permissionsHint")}
        renderBadge={(item, remove) => (
          <TranslatedBadge
            kind="permission"
            token={typeof item === "string" ? item : item.name}
            onRemove={remove}
          />
        )}
      />

      <div>
        <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
          {t("core.fileAccess.maxFileSizeMB")}
        </label>
        <input
          type="number"
          step="0.1"
          min="0"
          value={section.maxFileSizeMB ?? ""}
          onChange={(e) => {
            const val = e.target.value;
            onChange({
              ...section,
              maxFileSizeMB: val === "" ? undefined : parseFloat(val),
            });
          }}
          placeholder={t("core.fileAccess.placeholder.maxFileSizeMB")}
          className="w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors"
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
          value={section.allowedExtensions}
          onChange={(vals) =>
            onChange({
              ...section,
              allowedExtensions: vals as string[],
            })}
          formatHint={t("core.fileAccess.allowedExtensionsHint")}
        />
      </div>
    </div>
  );
}

const FileAccessSubform = forwardRef<
  SubformRef,
  { initialData?: Record<string, unknown> }
>(({ initialData }, ref) => {
  const { t } = useLocale();

  const [name, setName] = useState((initialData?.name as string) ?? "");
  const [categoryPattern, setCategoryPattern] = useState(
    (initialData?.categoryPattern as string) ?? "",
  );
  const [download, setDownload] = useState<FileAccessSection>(
    normalizeSection(
      initialData?.download as Record<string, unknown> | undefined,
    ),
  );
  const [upload, setUpload] = useState<FileAccessUploadSection>(
    normalizeUploadSection(
      initialData?.upload as Record<string, unknown> | undefined,
    ),
  );

  useImperativeHandle(ref, () => ({
    getData: () => ({
      name,
      categoryPattern,
      download,
      upload,
    }),
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

      <SectionEditor
        title={t("core.fileAccess.download")}
        section={download}
        onChange={setDownload}
        t={t}
      />

      <UploadSectionEditor
        section={upload}
        onChange={setUpload}
        t={t}
      />
    </div>
  );
});

FileAccessSubform.displayName = "FileAccessSubform";
export default FileAccessSubform;
