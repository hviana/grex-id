"use client";

import { forwardRef, useImperativeHandle, useState } from "react";
import type { SubformRef } from "@/src/contracts/high-level/components";
import { useTenantContext } from "@/src/hooks/useTenantContext";
import type { RoleFormProps } from "@/src/contracts/high-level/component-props";
import ToggleField from "@/src/components/fields/ToggleField";

const RoleForm = forwardRef<SubformRef, RoleFormProps>(
  ({ initialData, initialGranular }, ref) => {
    const { t } = useTenantContext();
    const [name, setName] = useState((initialData?.name as string) ?? "");
    const [systemId, setSystemId] = useState(
      (initialData?.systemId as string) ?? "",
    );
    const [granular, setGranular] = useState(
      (initialData?.granular as boolean) ?? initialGranular ?? false,
    );
    const fixedGranular = initialGranular !== undefined;

    useImperativeHandle(ref, () => ({
      getData: () => ({
        name,
        systemId,
        granular,
      }),
      isValid: () => name.trim().length > 0 && systemId.trim().length > 0,
    }));

    const inputCls =
      "w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white outline-none focus:border-[var(--color-primary-green)] transition-colors";

    return (
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
            {t("core.roles.name")} *
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className={inputCls}
            placeholder={t("core.roles.placeholder.name")}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
            {t("core.roles.system")} *
          </label>
          <input
            type="text"
            value={systemId}
            onChange={(e) => setSystemId(e.target.value)}
            required
            className={inputCls}
            placeholder={t("core.roles.placeholder.systemId")}
          />
        </div>
        {fixedGranular
          ? (
            <p className="text-xs text-[var(--color-light-text)]">
              {granular
                ? t("core.roles.granularApiOnly")
                : t("core.roles.granularUserOnly")}
            </p>
          )
          : (
            <ToggleField
              on={granular}
              onChange={setGranular}
              label={t("core.roles.granular")}
            />
          )}
      </div>
    );
  },
);

RoleForm.displayName = "RoleForm";
export default RoleForm;
