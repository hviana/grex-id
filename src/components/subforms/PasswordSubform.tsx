"use client";

import { forwardRef, useImperativeHandle, useState } from "react";
import { isValidPassword } from "@/src/lib/validators";
import type { SubformRef } from "@/src/contracts/high-level/components";
import { useTenantContext } from "@/src/hooks/useTenantContext";
import type { PasswordSubformProps } from "@/src/contracts/high-level/component-props";

const PasswordSubform = forwardRef<SubformRef, PasswordSubformProps>(
  ({ initialData, requiredFields }, ref) => {
    const { t } = useTenantContext();
    const isEdit = !!initialData?.id;

    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");

    useImperativeHandle(ref, () => ({
      getData: () => {
        if (!password) return {};
        return { password, confirmPassword };
      },
      isValid: () => {
        if (!isEdit || password) {
          if (!isValidPassword(password)) return false;
          if (password !== confirmPassword) return false;
        }
        return true;
      },
    }));

    const passwordRequired = requiredFields?.includes("password") ?? !isEdit;

    return (
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
            {t("auth.login.password")}{" "}
            {passwordRequired ? "*" : "(leave blank to keep)"}
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required={passwordRequired}
            minLength={8}
            className="w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white outline-none focus:border-[var(--color-primary-green)] transition-colors"
          />
        </div>
        {(password || passwordRequired) && (
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("auth.register.confirmPassword")} *
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              className="w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white outline-none focus:border-[var(--color-primary-green)] transition-colors"
            />
          </div>
        )}
      </div>
    );
  },
);

PasswordSubform.displayName = "PasswordSubform";
export default PasswordSubform;
