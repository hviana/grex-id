"use client";

import { useState } from "react";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import { isValidPassword } from "@/src/lib/validators";
import { useTenantContext } from "@/src/hooks/useTenantContext";

/**
 * Password-change subform (§8.7). Unlike the generic {@link PasswordSubform}
 * used in register/edit flows, this one requires the current password for
 * verification and triggers a human-confirmation flow — the new password only
 * takes effect after the user clicks the confirmation link.
 */
export default function PasswordChangeSubform() {
  const { t } = useTenantContext();
  const { systemToken } = useTenantContext();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const canSubmit = currentPassword.length > 0 &&
    isValidPassword(newPassword) &&
    newPassword === confirmPassword &&
    !saving;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch("/api/auth/password-change", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword,
        }),
      });
      const json = await res.json();

      if (!json.success) {
        const msg = json.error?.errors?.[0] ?? json.error?.message ??
          "common.error.generic";
        setError(msg);
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess(true);
      setTimeout(() => setSuccess(false), 8000);
    } catch {
      setError("common.error.network");
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors";

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-sm text-[var(--color-light-text)]">
        {t("auth.passwordChange.confirmationSent")}
      </p>

      <ErrorDisplay message={error} />
      {success && (
        <div className="rounded-lg bg-[var(--color-primary-green)]/10 border border-[var(--color-primary-green)]/30 px-4 py-3 text-sm text-[var(--color-primary-green)]">
          {t("auth.passwordChange.confirmationSent")}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
          {t("auth.passwordChange.currentPassword")} *
        </label>
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
          required
          className={inputCls}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
          {t("auth.passwordChange.newPassword")} *
        </label>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
          className={inputCls}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
          {t("auth.passwordChange.confirmPassword")} *
        </label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          required
          className={inputCls}
        />
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-4 py-2.5 font-semibold text-black text-sm transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {saving && (
          <Spinner size="sm" className="border-black border-t-transparent" />
        )}
        {t("auth.passwordChange.submit")}
      </button>
    </form>
  );
}
