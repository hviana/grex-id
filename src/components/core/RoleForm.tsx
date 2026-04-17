"use client";

import { forwardRef, useImperativeHandle, useState } from "react";
import { useLocale } from "@/src/hooks/useLocale";
import type { SubformRef } from "@/src/components/shared/GenericList";
import MultiBadgeField from "@/src/components/fields/MultiBadgeField";

interface RoleFormProps {
  initialData?: Record<string, unknown>;
}

const RoleForm = forwardRef<SubformRef, RoleFormProps>(
  ({ initialData }, ref) => {
    const { t } = useLocale();
    const [name, setName] = useState((initialData?.name as string) ?? "");
    const [systemId, setSystemId] = useState(
      (initialData?.systemId as string) ?? "",
    );
    const [isBuiltIn] = useState((initialData?.isBuiltIn as boolean) ?? false);
    const [permissions, setPermissions] = useState<string[]>(
      (initialData?.permissions as string[]) ?? [],
    );

    useImperativeHandle(ref, () => ({
      getData: () => ({
        name,
        systemId,
        isBuiltIn,
        permissions,
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
        {isBuiltIn && (
          <p className="text-xs text-[var(--color-light-text)]">
            ⚠️ {t("core.roles.builtInWarning")}
          </p>
        )}
        <MultiBadgeField
          name={t("core.roles.permissions")}
          mode="custom"
          value={permissions}
          onChange={(vals) => setPermissions(vals as string[])}
          formatHint={t("core.roles.permissionsHint")}
        />
      </div>
    );
  },
);

RoleForm.displayName = "RoleForm";
export default RoleForm;
