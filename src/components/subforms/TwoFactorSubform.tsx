"use client";

import { useState } from "react";
import { useAuth } from "@/src/hooks/useAuth";
import { useLocale } from "@/src/hooks/useLocale";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";

interface TwoFactorSubformProps {
  twoFactorEnabled: boolean;
  onRequested?: () => void;
}

/**
 * Profile-page 2FA section (§8.8.4). Owns the setup-totp + confirm-totp
 * dance for enable, and the direct "disable" request for disable. All state
 * changes are gated through a server-issued confirmation link.
 */
export default function TwoFactorSubform({
  twoFactorEnabled,
  onRequested,
}: TwoFactorSubformProps) {
  const { systemToken } = useAuth();
  const { t } = useLocale();

  const [setupOpen, setSetupOpen] = useState(false);
  const [provisioningUri, setProvisioningUri] = useState<string | null>(null);
  const [code, setCode] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const openSetup = async () => {
    if (!systemToken) return;
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/two-factor", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({ action: "setup-totp" }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error?.message ?? "common.error.generic");
        return;
      }
      setProvisioningUri(json.data.provisioningUri);
      setSetupOpen(true);
    } catch {
      setError("common.error.network");
    } finally {
      setLoading(false);
    }
  };

  const confirmSetup = async () => {
    if (!systemToken) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/two-factor", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({
          action: "confirm-totp",
          code,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        const msg = json.error?.errors?.[0] ?? json.error?.message ??
          "common.error.generic";
        setError(msg);
        return;
      }
      setSetupOpen(false);
      setCode("");
      setProvisioningUri(null);
      setSuccess("common.twoFactor.setup.confirmationSent");
      onRequested?.();
    } catch {
      setError("common.error.network");
    } finally {
      setLoading(false);
    }
  };

  const requestDisable = async () => {
    if (!systemToken) return;
    if (!confirm(t("common.twoFactor.disable.confirm"))) return;
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/two-factor", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({ action: "disable" }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error?.message ?? "common.error.generic");
        return;
      }
      setSuccess("common.twoFactor.disable.confirmationSent");
      onRequested?.();
    } catch {
      setError("common.error.network");
    } finally {
      setLoading(false);
    }
  };

  const copySecret = async () => {
    if (!provisioningUri) return;
    try {
      await navigator.clipboard.writeText(provisioningUri);
    } catch {
      // clipboard unavailable — ignore
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--color-light-text)]">
        {t("common.twoFactor.description")}
      </p>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-[var(--color-light-text)]">
          {t("common.twoFactor.title")}:
        </span>
        <span
          className={twoFactorEnabled
            ? "px-2 py-0.5 rounded-full bg-[var(--color-primary-green)]/20 text-[var(--color-primary-green)] text-xs"
            : "px-2 py-0.5 rounded-full bg-white/5 text-[var(--color-light-text)] text-xs"}
        >
          {twoFactorEnabled
            ? t("common.twoFactor.status.enabled")
            : t("common.twoFactor.status.disabled")}
        </span>
      </div>

      <ErrorDisplay message={error} />
      {success && (
        <div className="mt-1 rounded-lg bg-[var(--color-primary-green)]/10 border border-[var(--color-primary-green)]/30 px-4 py-3 text-sm text-[var(--color-primary-green)]">
          {t(success)}
        </div>
      )}

      {!twoFactorEnabled && !setupOpen && (
        <button
          type="button"
          onClick={openSetup}
          disabled={loading}
          className="rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-4 py-2 text-sm font-semibold text-black transition-all hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
        >
          {loading && (
            <Spinner
              size="sm"
              className="border-black border-t-transparent"
            />
          )}
          {t("common.twoFactor.enable")}
        </button>
      )}

      {twoFactorEnabled && (
        <button
          type="button"
          onClick={requestDisable}
          disabled={loading}
          className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-400 transition-all hover:bg-red-500/20 disabled:opacity-50 flex items-center gap-2"
        >
          {loading && <Spinner size="sm" />}
          {t("common.twoFactor.disable")}
        </button>
      )}

      {setupOpen && provisioningUri && (
        <div className="mt-3 rounded-xl border border-dashed border-[var(--color-dark-gray)] bg-white/5 p-4 space-y-3">
          <h4 className="text-sm font-semibold text-white">
            {t("common.twoFactor.setup.title")}
          </h4>
          <p className="text-xs text-[var(--color-light-text)]">
            {t("common.twoFactor.setup.intro")}
          </p>
          <div>
            <label className="block text-xs text-[var(--color-light-text)] mb-1">
              {t("common.twoFactor.setup.uriLabel")}
            </label>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-black/40 px-2 py-1 text-xs text-[var(--color-light-text)]">
                {provisioningUri}
              </code>
              <button
                type="button"
                onClick={copySecret}
                className="shrink-0 rounded border border-[var(--color-dark-gray)] px-2 py-1 text-xs text-[var(--color-light-text)] hover:bg-white/5"
              >
                {t("common.twoFactor.setup.copy")}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs text-[var(--color-light-text)] mb-1">
              {t("common.twoFactor.setup.codeLabel")}
            </label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors"
              placeholder="000000"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={confirmSetup}
              disabled={loading || code.length < 6}
              className="rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-4 py-2 text-sm font-semibold text-black transition-all hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
            >
              {loading && (
                <Spinner
                  size="sm"
                  className="border-black border-t-transparent"
                />
              )}
              {t("common.twoFactor.setup.submit")}
            </button>
            <button
              type="button"
              onClick={() => {
                setSetupOpen(false);
                setCode("");
                setProvisioningUri(null);
              }}
              className="rounded-lg border border-[var(--color-dark-gray)] px-4 py-2 text-sm text-[var(--color-light-text)] hover:bg-white/5"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
