"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { useLocale } from "@/src/hooks/useLocale";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import type { SubformRef } from "@/src/components/shared/GenericList";
import type { RecoveryChannel } from "@/src/contracts/recovery-channel";

const MAX_CHANNELS = 10;

interface RecoveryChannelsSubformProps {
  initialData?: Record<string, unknown>;
  systemToken?: string;
}

function formatPhoneValue(value: string): string {
  return value.replace(/(\d{2})(\d{2})(\d{5})(\d{4})/, "+$1 ($2) $3-$4");
}

function channelBadge(ch: RecoveryChannel, t: (k: string) => string) {
  return ch.verified
    ? (
      <span className="text-xs bg-[var(--color-primary-green)]/20 text-[var(--color-primary-green)] px-2 py-0.5 rounded-full whitespace-nowrap">
        ✅ {t("common.recoveryChannels.verified")}
      </span>
    )
    : (
      <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full whitespace-nowrap">
        ⚠️ {t("common.recoveryChannels.unverified")}
      </span>
    );
}

const RecoveryChannelsSubform = forwardRef<
  SubformRef,
  RecoveryChannelsSubformProps
>(({ systemToken }, ref) => {
  const { t } = useLocale();

  const [channels, setChannels] = useState<RecoveryChannel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [channelType, setChannelType] = useState<"email" | "phone">("email");
  const [channelValue, setChannelValue] = useState("");
  const [addingChannel, setAddingChannel] = useState(false);
  const [channelError, setChannelError] = useState<string | null>(null);
  const [channelSuccess, setChannelSuccess] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const fetchChannels = async () => {
    try {
      const res = await fetch("/api/recovery-channels", {
        headers: { Authorization: `Bearer ${systemToken}` },
      });
      const json = await res.json();
      if (json.success) {
        setChannels(json.data ?? []);
      }
    } catch {
      // silently fail
    } finally {
      setChannelsLoading(false);
    }
  };

  useEffect(() => {
    if (systemToken) {
      fetchChannels();
    }
  }, [systemToken]);

  useImperativeHandle(ref, () => ({
    getData: () => ({ channels }),
    isValid: () => true,
  }));

  const clearFeedback = () => {
    setChannelError(null);
    setChannelSuccess(null);
  };

  const handleAddChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!channelValue.trim()) return;
    setAddingChannel(true);
    clearFeedback();

    try {
      const res = await fetch("/api/recovery-channels", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({ type: channelType, value: channelValue }),
      });
      const json = await res.json();

      if (!json.success) {
        const msg = json.error?.errors?.[0] ?? json.error?.message ??
          "common.error.generic";
        setChannelError(msg);
      } else {
        setChannelValue("");
        setChannelSuccess("common.recoveryChannels.verifySent");
        await fetchChannels();
        setTimeout(() => setChannelSuccess(null), 5000);
      }
    } catch {
      setChannelError("common.error.network");
    } finally {
      setAddingChannel(false);
    }
  };

  const handleResendVerification = async (channelId: string) => {
    setResendingId(channelId);
    clearFeedback();

    try {
      const res = await fetch(
        "/api/recovery-channels?action=resend-verification",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${systemToken}`,
          },
          body: JSON.stringify({ channelId }),
        },
      );
      const json = await res.json();

      if (!json.success) {
        const msg = json.error?.message ?? "common.error.generic";
        setChannelError(msg);
      } else {
        setChannelSuccess("common.recoveryChannels.verifySent");
        setTimeout(() => setChannelSuccess(null), 5000);
      }
    } catch {
      setChannelError("common.error.network");
    } finally {
      setResendingId(null);
    }
  };

  const handleRemoveChannel = async (channelId: string) => {
    if (!confirm(t("common.recoveryChannels.removeConfirm"))) return;
    setDeletingId(channelId);
    clearFeedback();

    try {
      const res = await fetch("/api/recovery-channels", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({ channelId }),
      });
      const json = await res.json();

      if (json.success) {
        await fetchChannels();
      } else {
        const msg = json.error?.message ?? "common.error.generic";
        setChannelError(msg);
      }
    } catch {
      setChannelError("common.error.network");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--color-light-text)]">
        {t("common.recoveryChannels.description")}
      </p>

      <ErrorDisplay message={channelError} />
      {channelSuccess && (
        <div className="rounded-lg bg-[var(--color-primary-green)]/10 border border-[var(--color-primary-green)]/30 px-4 py-3 text-sm text-[var(--color-primary-green)]">
          {t(channelSuccess)}
        </div>
      )}

      {/* Channel list */}
      {channelsLoading
        ? (
          <div className="flex justify-center py-6">
            <Spinner size="md" />
          </div>
        )
        : channels.length === 0
        ? (
          <p className="text-sm text-[var(--color-light-text)] text-center py-4">
            {t("common.empty")}
          </p>
        )
        : (
          <div className="space-y-2">
            {channels.map((ch) => {
              const id = String(ch.id);
              const isDeleting = deletingId === id;
              const isResending = resendingId === id;
              const displayValue = ch.type === "email"
                ? ch.value
                : formatPhoneValue(ch.value);

              return (
                <div
                  key={id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-4"
                >
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="text-xl shrink-0">
                      {ch.type === "email" ? "📧" : "📱"}
                    </span>
                    <span className="text-sm text-white truncate">
                      {displayValue}
                    </span>
                    {channelBadge(ch, t)}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!ch.verified && (
                      <button
                        type="button"
                        onClick={() => handleResendVerification(id)}
                        disabled={isResending}
                        className="text-xs text-[var(--color-secondary-blue)] hover:text-[var(--color-primary-green)] transition-colors disabled:opacity-50 flex items-center gap-1"
                      >
                        {isResending && (
                          <Spinner
                            size="sm"
                            className="border-[var(--color-secondary-blue)] border-t-transparent"
                          />
                        )}
                        {t("common.recoveryChannels.resendVerification")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRemoveChannel(id)}
                      disabled={isDeleting}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-50 flex items-center gap-1"
                    >
                      {isDeleting && (
                        <Spinner
                          size="sm"
                          className="border-red-400 border-t-transparent"
                        />
                      )}
                      {t("common.recoveryChannels.remove")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

      {/* Add channel form */}
      {channels.length < MAX_CHANNELS && (
        <form
          onSubmit={handleAddChannel}
          className="flex flex-col sm:flex-row gap-3"
        >
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setChannelType("email")}
              className={`px-3 py-2 text-sm rounded-lg transition-colors ${
                channelType === "email"
                  ? "bg-[var(--color-primary-green)]/20 text-[var(--color-primary-green)] border border-[var(--color-primary-green)]/30"
                  : "bg-white/5 text-[var(--color-light-text)] border border-[var(--color-dark-gray)]"
              }`}
            >
              📧 {t("common.recoveryChannels.type.email")}
            </button>
            <button
              type="button"
              onClick={() => setChannelType("phone")}
              className={`px-3 py-2 text-sm rounded-lg transition-colors ${
                channelType === "phone"
                  ? "bg-[var(--color-primary-green)]/20 text-[var(--color-primary-green)] border border-[var(--color-primary-green)]/30"
                  : "bg-white/5 text-[var(--color-light-text)] border border-[var(--color-dark-gray)]"
              }`}
            >
              📱 {t("common.recoveryChannels.type.phone")}
            </button>
          </div>
          <input
            type={channelType === "email" ? "email" : "tel"}
            value={channelValue}
            onChange={(e) => setChannelValue(e.target.value)}
            placeholder={t("common.placeholder.recoveryChannel")}
            required
            className="flex-1 rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors"
          />
          <button
            type="submit"
            disabled={addingChannel || !channelValue.trim()}
            className="rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-4 py-2.5 font-semibold text-black text-sm transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 whitespace-nowrap"
          >
            {addingChannel && (
              <Spinner
                size="sm"
                className="border-black border-t-transparent"
              />
            )}
            {t("common.recoveryChannels.add")}
          </button>
        </form>
      )}

      {channels.length >= MAX_CHANNELS && (
        <p className="text-sm text-yellow-400 text-center">
          {t("common.recoveryChannels.maxReached")}
        </p>
      )}
    </div>
  );
});

RecoveryChannelsSubform.displayName = "RecoveryChannelsSubform";
export default RecoveryChannelsSubform;
