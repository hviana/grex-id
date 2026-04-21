"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { useLocale } from "@/src/hooks/useLocale";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import type { SubformRef } from "@/src/components/shared/GenericList";
import type { EntityChannel } from "@/src/contracts/entity-channel";

const DEFAULT_MAX = 10;

export interface EntityChannelsSubformProps {
  /**
   * Channel types that should appear in the add dropdown. Order defines the
   * default selected type (first entry).
   */
  channelTypes: string[];
  /**
   * Channel types the owner must always have at least one verified row for.
   * Enforced server-side on delete — clients should still prevent the UI
   * action to match behavior.
   */
  requiredTypes?: string[];
  initialData?: Record<string, unknown>;
  systemToken?: string;
}

function formatPhoneValue(value: string): string {
  return value.replace(/(\d{2})(\d{2})(\d{5})(\d{4})/, "+$1 ($2) $3-$4");
}

function iconForType(type: string): string {
  if (type === "email") return "📧";
  if (type === "phone") return "📱";
  return "📡";
}

function displayValue(channel: EntityChannel): string {
  if (channel.type === "phone") return formatPhoneValue(channel.value);
  return channel.value;
}

function channelBadge(ch: EntityChannel, t: (k: string) => string) {
  return ch.verified
    ? (
      <span className="text-xs bg-[var(--color-primary-green)]/20 text-[var(--color-primary-green)] px-2 py-0.5 rounded-full whitespace-nowrap">
        ✅ {t("common.entityChannels.verified")}
      </span>
    )
    : (
      <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full whitespace-nowrap">
        ⚠️ {t("common.entityChannels.unverified")}
      </span>
    );
}

const EntityChannelsSubform = forwardRef<
  SubformRef,
  EntityChannelsSubformProps
>(
  ({ systemToken, channelTypes, requiredTypes }, ref) => {
    const { t } = useLocale();

    const initialType = channelTypes[0] ?? "email";
    const [channels, setChannels] = useState<EntityChannel[]>([]);
    const [channelsLoading, setChannelsLoading] = useState(true);
    const [channelType, setChannelType] = useState<string>(initialType);
    const [channelValue, setChannelValue] = useState("");
    const [addingChannel, setAddingChannel] = useState(false);
    const [channelError, setChannelError] = useState<string | null>(null);
    const [channelSuccess, setChannelSuccess] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [resendingId, setResendingId] = useState<string | null>(null);

    const required = requiredTypes ?? [];

    const fetchChannels = async () => {
      try {
        const res = await fetch("/api/entity-channels", {
          headers: { Authorization: `Bearer ${systemToken}` },
        });
        const json = await res.json();
        if (json.success) setChannels(json.data ?? []);
      } catch {
        // silently fail
      } finally {
        setChannelsLoading(false);
      }
    };

    useEffect(() => {
      if (systemToken) fetchChannels();
    }, [systemToken]);

    useImperativeHandle(ref, () => ({
      getData: () => ({ channels }),
      isValid: () => true,
    }));

    const clearFeedback = () => {
      setChannelError(null);
      setChannelSuccess(null);
    };

    const inputType = channelType === "email"
      ? "email"
      : channelType === "phone"
      ? "tel"
      : "text";

    const handleAddChannel = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!channelValue.trim()) return;
      setAddingChannel(true);
      clearFeedback();
      try {
        const res = await fetch("/api/entity-channels", {
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
          setChannelSuccess("common.entityChannels.verifySent");
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
          "/api/entity-channels?action=resend-verification",
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
          setChannelSuccess("common.entityChannels.verifySent");
          setTimeout(() => setChannelSuccess(null), 5000);
        }
      } catch {
        setChannelError("common.error.network");
      } finally {
        setResendingId(null);
      }
    };

    const canRemove = (ch: EntityChannel): boolean => {
      if (!ch.verified) return true;
      if (!required.includes(ch.type)) return true;
      const sameTypeVerifiedCount = channels.filter(
        (c) => c.verified && c.type === ch.type,
      ).length;
      return sameTypeVerifiedCount > 1;
    };

    const handleRemoveChannel = async (channelId: string) => {
      if (!confirm(t("common.entityChannels.removeConfirm"))) return;
      setDeletingId(channelId);
      clearFeedback();
      try {
        const res = await fetch("/api/entity-channels", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${systemToken}`,
          },
          body: JSON.stringify({ channelId, requiredTypes: required }),
        });
        const json = await res.json();
        if (json.success) {
          await fetchChannels();
        } else {
          const msg = json.error?.errors?.[0] ?? json.error?.message ??
            "common.error.generic";
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
          {t("common.entityChannels.description")}
        </p>

        <ErrorDisplay message={channelError} />
        {channelSuccess && (
          <div className="rounded-lg bg-[var(--color-primary-green)]/10 border border-[var(--color-primary-green)]/30 px-4 py-3 text-sm text-[var(--color-primary-green)]">
            {t(channelSuccess)}
          </div>
        )}

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
                const removable = canRemove(ch);

                return (
                  <div
                    key={id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-4"
                  >
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <span className="text-xl shrink-0">
                        {iconForType(ch.type)}
                      </span>
                      <span className="text-sm text-white truncate">
                        {displayValue(ch)}
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
                          {t("common.entityChannels.resendVerification")}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemoveChannel(id)}
                        disabled={isDeleting || !removable}
                        title={!removable
                          ? t("common.entityChannels.requiredHint")
                          : undefined}
                        className="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-50 flex items-center gap-1"
                      >
                        {isDeleting && (
                          <Spinner
                            size="sm"
                            className="border-red-400 border-t-transparent"
                          />
                        )}
                        {t("common.entityChannels.remove")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

        {channels.length < DEFAULT_MAX && channelTypes.length > 0 && (
          <form
            onSubmit={handleAddChannel}
            className="flex flex-col sm:flex-row gap-3"
          >
            <div className="flex gap-1 flex-wrap">
              {channelTypes.map((ct) => (
                <button
                  key={ct}
                  type="button"
                  onClick={() => setChannelType(ct)}
                  className={`px-3 py-2 text-sm rounded-lg transition-colors ${
                    channelType === ct
                      ? "bg-[var(--color-primary-green)]/20 text-[var(--color-primary-green)] border border-[var(--color-primary-green)]/30"
                      : "bg-white/5 text-[var(--color-light-text)] border border-[var(--color-dark-gray)]"
                  }`}
                >
                  {iconForType(ct)} {t(`common.entityChannels.type.${ct}`)}
                </button>
              ))}
            </div>
            <input
              type={inputType}
              value={channelValue}
              onChange={(e) => setChannelValue(e.target.value)}
              placeholder={t("common.placeholder.entityChannel")}
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
              {t("common.entityChannels.add")}
            </button>
          </form>
        )}

        {channels.length >= DEFAULT_MAX && (
          <p className="text-sm text-yellow-400 text-center">
            {t("common.entityChannels.maxReached")}
          </p>
        )}
      </div>
    );
  },
);

EntityChannelsSubform.displayName = "EntityChannelsSubform";
export default EntityChannelsSubform;
