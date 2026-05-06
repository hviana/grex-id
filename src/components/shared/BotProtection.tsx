"use client";

import { useCallback, useState } from "react";
import Spinner from "./Spinner.tsx";
import { useTenantContext } from "@/src/hooks/useTenantContext";
import type { BotProtectionProps } from "@/src/contracts/high-level/component-props";

export default function BotProtection({ onVerified }: BotProtectionProps) {
  const { t } = useTenantContext();
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleChallenge = useCallback(async () => {
    setLoading(true);
    // Simple challenge: generate a token based on timing + random.
    // In production, replace with a proper CAPTCHA service.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const token = crypto.randomUUID();
    setVerified(true);
    setLoading(false);
    onVerified(token);
  }, [onVerified]);

  if (verified) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--color-primary-green)]">
        <span>✅</span>
        <span>{t("auth.bot.verified")}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleChallenge}
      disabled={loading}
      className="flex items-center gap-2 px-4 py-2 text-sm border border-[var(--color-dark-gray)] rounded hover:border-[var(--color-primary-green)] transition-colors disabled:opacity-50"
    >
      {loading ? <Spinner size="sm" /> : <span>🤖</span>}
      <span>{loading ? t("auth.bot.verifying") : t("auth.bot.challenge")}</span>
    </button>
  );
}
