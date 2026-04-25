"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import { useLocale } from "@/src/hooks/useLocale";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import type { SubformRef } from "@/src/components/shared/GenericList";
import type { EntityChannel } from "@/src/contracts/entity-channel";

const DEFAULT_MAX = 10;

/**
 * EntityChannelsSubform
 *
 * Shared UI for collecting entity_channel rows (§8.7, §10.5). Two modes:
 *
 * - `"authenticated"` (default): talks to `/api/entity-channels` for an
 *   authenticated user — fetches, adds, removes, resends confirmation. Used
 *   in ProfilePage, lead editors, etc.
 * - `"local"`: holds channels in component state only. Used by
 *   unauthenticated forms (register, public lead submission) where channels
 *   are submitted as part of the parent request, not through
 *   `/api/entity-channels`. Exposes the accumulated list via
 *   `getData()`/`isValid()` so the parent form can collect them.
 */

export type EntityChannelsSubformMode = "authenticated" | "local";

export interface EntityChannelsSubformProps {
  /**
   * Channel types that should appear in the add dropdown. Order defines the
   * default selected type (first entry).
   */
  channelTypes: string[];
  /**
   * Channel types the owner must always have at least one entry for. In
   * `"authenticated"` mode a verified entry is required; in `"local"` mode
   * at least one entry of each required type must be present before the
   * parent form can submit.
   */
  requiredTypes?: string[];
  /**
   * `"authenticated"` (default) talks to `/api/entity-channels`.
   * `"local"` keeps channels in memory; the parent form collects them via
   * `getData()`.
   */
  mode?: EntityChannelsSubformMode;
  /**
   * Prefill for local mode — channels entered on an earlier render that the
   * parent wants to restore.
   */
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
      <span className="text-xs bg-[var(--color-primary-green)]/20 text-[var(--color-primary-green)] px-1.5 py-0.5 rounded-full whitespace-nowrap">
        ✅ {t("common.entityChannels.verified")}
      </span>
    )
    : (
      <span className="text-xs bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded-full whitespace-nowrap">
        ⚠️ {t("common.entityChannels.unverified")}
      </span>
    );
}

const EntityChannelsSubform = forwardRef<
  SubformRef,
  EntityChannelsSubformProps
>(
  (
    {
      systemToken,
      channelTypes,
      requiredTypes,
      mode = "authenticated",
      initialData,
    },
    ref,
  ) => {
    const { t } = useLocale();

    const initialType = channelTypes[0] ?? "email";
    const [channels, setChannels] = useState<EntityChannel[]>(() => {
      const seed = initialData?.channelIds;
      return Array.isArray(seed)
        ? (seed as EntityChannel[]).filter((c) =>
          c && typeof c === "object" && typeof c.type === "string" &&
          typeof c.value === "string"
        )
        : [];
    });
    const [channelsLoading, setChannelsLoading] = useState(
      mode === "authenticated",
    );
    const [channelType, setChannelType] = useState<string>(initialType);
    const [channelValue, setChannelValue] = useState("");
    const [addingChannel, setAddingChannel] = useState(false);
    const [channelError, setChannelError] = useState<string | null>(null);
    const [channelSuccess, setChannelSuccess] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [resendingId, setResendingId] = useState<string | null>(null);

    const required = requiredTypes ?? [];

    const fetchChannels = useCallback(async () => {
      if (!systemToken) return;
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
    }, [systemToken]);

    useEffect(() => {
      if (mode !== "authenticated" || !systemToken) return;
      let cancelled = false;
      void (async () => {
        try {
          const res = await fetch("/api/entity-channels", {
            headers: { Authorization: `Bearer ${systemToken}` },
          });
          const json = await res.json();
          if (!cancelled && json.success) setChannels(json.data ?? []);
        } catch {
          // silently fail
        } finally {
          if (!cancelled) setChannelsLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [mode, systemToken]);

    const isFormValid = useCallback((): boolean => {
      if (mode !== "local") return true;
      const pendingValue = channelValue.trim();
      const effectiveChannels = pendingValue
        ? [...channels, { type: channelType, value: pendingValue }]
        : channels;
      return required.every((type) =>
        effectiveChannels.some((c) => c.type === type)
      );
    }, [mode, required, channels, channelValue, channelType]);

    useImperativeHandle(ref, () => ({
      getData: () => {
        if (mode === "local") {
          const pendingValue = channelValue.trim();
          const allChannels: Array<{ type: string; value: string }> = channels
            .map((c) => ({
              type: c.type,
              value: c.value,
            }));
          if (
            pendingValue &&
            !allChannels.some(
              (c) => c.type === channelType && c.value === pendingValue,
            )
          ) {
            allChannels.push({ type: channelType, value: pendingValue });
          }
          return {
            channels: allChannels,
          };
        }
        return { channels };
      },
      isValid: () => isFormValid(),
    }), [mode, channels, channelValue, channelType, isFormValid]);

    const clearFeedback = () => {
      setChannelError(null);
      setChannelSuccess(null);
    };

    const inputType = channelType === "email"
      ? "email"
      : channelType === "phone"
      ? "tel"
      : "text";

    const handleAddChannel = async () => {
      const trimmed = channelValue.trim();
      if (!trimmed) return;
      clearFeedback();

      if (mode === "local") {
        if (
          channels.some((c) => c.type === channelType && c.value === trimmed)
        ) {
          setChannelError("auth.entityChannel.error.duplicate");
          return;
        }
        if (channels.length >= DEFAULT_MAX) {
          setChannelError("auth.entityChannel.error.maxReached");
          return;
        }
        const localRow: EntityChannel = {
          id: `local:${crypto.randomUUID()}`,
          type: channelType,
          value: trimmed,
          verified: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setChannels((prev) => [...prev, localRow]);
        setChannelValue("");
        return;
      }

      // authenticated mode
      setAddingChannel(true);
      try {
        const res = await fetch("/api/entity-channels", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${systemToken}`,
          },
          body: JSON.stringify({ type: channelType, value: trimmed }),
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
      if (mode !== "authenticated") return;
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

    const handleRemoveChannel = async (channelId: string) => {
      clearFeedback();
      if (mode === "local") {
        setChannels((prev) => prev.filter((c) => String(c.id) !== channelId));
        return;
      }
      if (!confirm(t("common.entityChannels.removeConfirm"))) return;
      setDeletingId(channelId);
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
      <div className="space-y-2">
        <p className="text-xs text-[var(--color-light-text)]">
          {mode === "local"
            ? t("common.entityChannels.description.local")
            : t("common.entityChannels.description")}
        </p>

        <ErrorDisplay message={channelError} />
        {channelSuccess && (
          <div className="rounded-lg bg-[var(--color-primary-green)]/10 border border-[var(--color-primary-green)]/30 px-3 py-2 text-xs text-[var(--color-primary-green)]">
            {t(channelSuccess)}
          </div>
        )}

        {channelsLoading
          ? (
            <div className="flex justify-center py-4">
              <Spinner size="md" />
            </div>
          )
          : channels.length === 0
          ? (
            <p className="text-xs text-[var(--color-light-text)] text-center py-3">
              {t("common.empty")}
            </p>
          )
          : (
            <div className="space-y-1.5">
              {channels.map((ch) => {
                const id = String(ch.id);
                const isDeleting = deletingId === id;
                const isResending = resendingId === id;

                return (
                  <div
                    key={id}
                    className="flex items-center gap-2 backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-lg px-3 py-2 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10"
                  >
                    <span className="text-base shrink-0">
                      {iconForType(ch.type)}
                    </span>
                    <div className="flex-1 min-w-0 flex items-center gap-1.5">
                      <span className="text-sm text-white truncate">
                        {displayValue(ch)}
                      </span>
                      {mode === "authenticated" && channelBadge(ch, t)}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {mode === "authenticated" && !ch.verified && (
                        <button
                          type="button"
                          onClick={() => handleResendVerification(id)}
                          disabled={isResending}
                          title={t("common.entityChannels.resendVerification")}
                          className="text-[var(--color-secondary-blue)] hover:text-[var(--color-primary-green)] transition-colors disabled:opacity-50 flex items-center justify-center w-6 h-6 rounded hover:bg-white/10"
                        >
                          {isResending
                            ? (
                              <Spinner
                                size="sm"
                                className="border-[var(--color-secondary-blue)] border-t-transparent"
                              />
                            )
                            : "🔄"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemoveChannel(id)}
                        disabled={isDeleting}
                        title={t("common.entityChannels.remove")}
                        className="text-red-400 hover:text-red-300 transition-colors disabled:opacity-50 flex items-center justify-center w-6 h-6 rounded hover:bg-white/10"
                      >
                        {isDeleting
                          ? (
                            <Spinner
                              size="sm"
                              className="border-red-400 border-t-transparent"
                            />
                          )
                          : "✕"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

        {channels.length < DEFAULT_MAX && channelTypes.length > 0 && (
          <div className="space-y-2 pt-1">
            <div className="flex gap-1 flex-wrap">
              {channelTypes.map((ct) => (
                <button
                  key={ct}
                  type="button"
                  onClick={() => setChannelType(ct)}
                  className={`px-2.5 py-1 text-xs rounded-md transition-all ${
                    channelType === ct
                      ? "bg-[var(--color-primary-green)]/20 text-[var(--color-primary-green)] border border-[var(--color-primary-green)]/30"
                      : "bg-white/5 text-[var(--color-light-text)] border border-transparent hover:border-[var(--color-dark-gray)]"
                  }`}
                >
                  {iconForType(ct)} {t(`common.entityChannels.type.${ct}`)}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type={inputType}
                value={channelValue}
                onChange={(e) => setChannelValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddChannel();
                  }
                }}
                placeholder={t("common.placeholder.entityChannel")}
                className="flex-1 min-w-0 rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors"
              />
              <button
                type="button"
                disabled={addingChannel || !channelValue.trim()}
                onClick={handleAddChannel}
                className="rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-4 py-2 font-semibold text-black text-sm transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
              >
                {addingChannel && (
                  <Spinner
                    size="sm"
                    className="border-black border-t-transparent"
                  />
                )}
                {t("common.entityChannels.add")}
              </button>
            </div>
          </div>
        )}

        {channels.length >= DEFAULT_MAX && (
          <p className="text-xs text-yellow-400 text-center">
            {t("common.entityChannels.maxReached")}
          </p>
        )}
      </div>
    );
  },
);

EntityChannelsSubform.displayName = "EntityChannelsSubform";
export default EntityChannelsSubform;
