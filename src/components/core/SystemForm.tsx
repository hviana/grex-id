"use client";

import { forwardRef, useImperativeHandle, useState } from "react";
import { useLocale } from "@/src/hooks/useLocale";
import type { SubformRef } from "@/src/components/shared/GenericList";
import FileUploadField from "@/src/components/fields/FileUploadField";

interface SystemFormProps {
  initialData?: Record<string, unknown>;
}

const SystemForm = forwardRef<SubformRef, SystemFormProps>(
  ({ initialData }, ref) => {
    const { t } = useLocale();
    const [name, setName] = useState((initialData?.name as string) ?? "");
    const [slug, setSlug] = useState((initialData?.slug as string) ?? "");
    const [logoUri, setLogoUri] = useState(
      (initialData?.logoUri as string) ?? "",
    );
    useImperativeHandle(ref, () => ({
      getData: () => ({
        name,
        slug,
        logoUri,
      }),
      isValid: () => name.trim().length > 0 && slug.trim().length > 0,
    }));

    const inputCls =
      "w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors";

    return (
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
            {t("core.systems.name")} *
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
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
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
            className={inputCls}
            placeholder={t("core.systems.placeholder.slug")}
          />
        </div>
        {slug.trim()
          ? (
            <FileUploadField
              fieldName={t("core.systems.logo")}
              allowedExtensions={[".svg", ".png", ".jpg", ".jpeg", ".webp"]}
              maxSizeBytes={5242880}
              companyId="core"
              systemSlug={slug}
              userId="superuser"
              category={["logos"]}
              previewEnabled
              onComplete={(uri) => setLogoUri(uri)}
            />
          )
          : (
            <p className="text-xs text-[var(--color-light-text)]/60">
              {t("core.systems.logoSlugRequired")}
            </p>
          )}
        {logoUri && (
          <div className="flex items-center gap-3">
            <img
              src={`/api/files/download?uri=${encodeURIComponent(logoUri)}`}
              alt="Logo"
              className="w-12 h-12 rounded border border-[var(--color-dark-gray)]"
            />
            <button
              type="button"
              onClick={() => setLogoUri("")}
              className="text-xs text-red-400 hover:text-red-300"
            >
              ✕
            </button>
          </div>
        )}
      </div>
    );
  },
);

SystemForm.displayName = "SystemForm";
export default SystemForm;
