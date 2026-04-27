"use client";

import { forwardRef, useImperativeHandle, useState } from "react";
import type { SubformRef } from "@/src/components/shared/GenericList";
import { useTenantContext } from "@/src/hooks/useTenantContext";

interface NameDescSubformProps {
  initialData?: Record<string, unknown>;
  requiredFields?: string[];
  visibleFields?: string[];
  maxNameLength?: number;
  maxDescriptionLength?: number;
}

const NameDescSubform = forwardRef<SubformRef, NameDescSubformProps>(
  (
    {
      initialData,
      requiredFields = ["name"],
      visibleFields = ["name", "description"],
      maxNameLength = 100,
      maxDescriptionLength = 500,
    },
    ref,
  ) => {
    const { t } = useTenantContext();

    const [name, setName] = useState((initialData?.name as string) ?? "");
    const [description, setDescription] = useState(
      (initialData?.description as string) ?? "",
    );

    const showName = visibleFields.includes("name");
    const showDescription = visibleFields.includes("description");
    const nameRequired = showName && requiredFields.includes("name");
    const descriptionRequired = showDescription &&
      requiredFields.includes("description");

    useImperativeHandle(ref, () => ({
      getData: () => {
        const data: Record<string, unknown> = {};
        if (showName) data.name = name;
        if (showDescription) data.description = description || null;
        return data;
      },
      isValid: () => {
        if (showName) {
          if (nameRequired && !name.trim()) return false;
          if (name.length > maxNameLength) return false;
        }
        if (showDescription) {
          if (descriptionRequired && !description.trim()) return false;
          if (description.length > maxDescriptionLength) return false;
        }
        return true;
      },
    }));

    return (
      <div className="space-y-3">
        {showName && (
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("common.name")} {nameRequired ? "*" : ""}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required={nameRequired}
              maxLength={maxNameLength}
              placeholder={t("common.placeholder.name")}
              className="w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors"
            />
            <span className="text-xs text-[var(--color-light-text)]">
              {name.length}/{maxNameLength}
            </span>
          </div>
        )}
        {showDescription && (
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("common.description")} {descriptionRequired ? "*" : ""}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required={descriptionRequired}
              maxLength={maxDescriptionLength}
              rows={3}
              placeholder={t("common.description")}
              className="w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors resize-none"
            />
            <span className="text-xs text-[var(--color-light-text)]">
              {description.length}/{maxDescriptionLength}
            </span>
          </div>
        )}
      </div>
    );
  },
);

NameDescSubform.displayName = "NameDescSubform";
export default NameDescSubform;
