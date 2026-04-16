"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/src/hooks/useAuth";
import { useLocale } from "@/src/hooks/useLocale";
import { useSystemContext } from "@/src/hooks/useSystemContext";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import FileUploadField from "@/src/components/fields/FileUploadField";
import type { RecoveryChannel } from "@/src/contracts/recovery-channel";

const MAX_CHANNELS = 10;

export default function ProfilePage() {
  const { user, systemToken, refresh } = useAuth();
  const { t } = useLocale();
  const { companyId, systemSlug } = useSystemContext();

  const [name, setName] = useState(user?.profile?.name ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [avatarUri, setAvatarUri] = useState(user?.profile?.avatarUri ?? "");
  const [age, setAge] = useState(user?.profile?.age?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Recovery channels state
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

  // Sync form state whenever the auth user object changes (e.g. after refresh)
  useEffect(() => {
    if (user) {
      setName(user.profile?.name ?? "");
      setPhone(user.phone ?? "");
      setAvatarUri(user.profile?.avatarUri ?? "");
      setAge(user.profile?.age?.toString() ?? "");
    }
  }, [user]);

  // Load recovery channels on mount
  useEffect(() => {
    if (systemToken) {
      fetchChannels();
    }
  }, [systemToken]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch("/api/users?action=profile", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({
          name,
          phone: phone || undefined,
          avatarUri: avatarUri || undefined,
          age: age ? Number(age) : undefined,
        }),
      });
      const json = await res.json();

      if (!json.success) {
        const msg = json.error?.errors?.[0] ?? json.error?.message ??
          "common.error.generic";
        setError(msg);
      } else {
        // Update local form state immediately from the API response
        if (json.data) {
          setName(json.data.profile?.name ?? name);
          setPhone(json.data.phone ?? "");
          setAvatarUri(json.data.profile?.avatarUri ?? "");
          setAge(json.data.profile?.age?.toString() ?? "");
        }
        setSuccess(true);
        // Refresh auth state so the rest of the app (e.g. ProfileMenu avatar) updates
        await refresh();
        setTimeout(() => setSuccess(false), 3000);
      }
    } catch {
      setError("common.error.network");
    } finally {
      setSaving(false);
    }
  };

  const handleAddChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!channelValue.trim()) return;
    setAddingChannel(true);
    setChannelError(null);
    setChannelSuccess(null);

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
    setChannelError(null);
    setChannelSuccess(null);

    try {
      const res = await fetch("/api/recovery-channels?action=resend-verification", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({ channelId }),
      });
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
    setChannelError(null);

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

  if (!user) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
        {t("common.profile.title")}
      </h1>

      {/* Profile form card */}
      <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-2xl p-6 hover:shadow-lg hover:shadow-[var(--color-light-green)]/20 transition-all duration-300">
        <ErrorDisplay message={error} />

        {success && (
          <div className="mb-4 rounded-lg bg-[var(--color-primary-green)]/10 border border-[var(--color-primary-green)]/30 px-4 py-3 text-sm text-[var(--color-primary-green)]">
            {t("common.profile.saved")}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Avatar */}
          <div className="flex flex-col items-center gap-4 pb-4 border-b border-[var(--color-dark-gray)]">
            {avatarUri
              ? (
                <div className="relative">
                  <img
                    src={`/api/files/download?uri=${
                      encodeURIComponent(avatarUri)
                    }`}
                    alt={name}
                    className="w-24 h-24 rounded-full border-2 border-[var(--color-primary-green)] object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setAvatarUri("")}
                    className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-red-500 text-white text-xs flex items-center justify-center hover:bg-red-400 transition-colors"
                  >
                    ✕
                  </button>
                </div>
              )
              : (
                <div className="w-24 h-24 rounded-full bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] flex items-center justify-center text-3xl font-bold text-black">
                  {name?.[0]?.toUpperCase() ?? "?"}
                </div>
              )}
            {companyId && systemSlug && user.id && (
              <FileUploadField
                fieldName={t("common.profile.avatar")}
                allowedExtensions={[".svg", ".png", ".jpg", ".jpeg", ".webp"]}
                maxSizeBytes={2097152}
                companyId={companyId}
                systemSlug={systemSlug}
                userId={user.id}
                category={["avatars"]}
                previewEnabled={false}
                onComplete={(uri) => setAvatarUri(uri)}
              />
            )}
          </div>

          {/* Email (read-only) */}
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("common.profile.email")}
            </label>
            <input
              type="email"
              value={user.email}
              readOnly
              className="w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-[var(--color-light-text)] outline-none cursor-not-allowed opacity-60"
            />
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("common.profile.nameLabel")} *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder={t("common.placeholder.name")}
              className="w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors"
            />
          </div>

          {/* Phone */}
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("common.profile.phone")}
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={t("common.placeholder.phone")}
              className="w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors"
            />
          </div>

          {/* Age */}
          <div>
            <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
              {t("common.profile.age")}
            </label>
            <input
              type="number"
              value={age}
              onChange={(e) => setAge(e.target.value)}
              min={1}
              max={150}
              placeholder={t("common.placeholder.age")}
              className="w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors"
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="w-full rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-4 py-3 font-semibold text-black transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving
              ? (
                <Spinner
                  size="sm"
                  className="border-black border-t-transparent"
                />
              )
              : null}
            {t("common.save")}
          </button>
        </form>
      </div>

      {/* Recovery Channels card */}
      <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-2xl p-6 hover:shadow-lg hover:shadow-[var(--color-light-green)]/20 transition-all duration-300">
        <h2 className="text-lg font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent mb-2">
          {t("common.recoveryChannels.title")}
        </h2>
        <p className="text-sm text-[var(--color-light-text)] mb-4">
          {t("common.recoveryChannels.description")}
        </p>

        <ErrorDisplay message={channelError} />
        {channelSuccess && (
          <div className="mb-4 rounded-lg bg-[var(--color-primary-green)]/10 border border-[var(--color-primary-green)]/30 px-4 py-3 text-sm text-[var(--color-primary-green)]">
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
              <div className="space-y-3 mb-4">
                {channels.map((ch) => (
                  <div
                    key={String(ch.id)}
                    className="flex items-center justify-between backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-4"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xl">
                        {ch.type === "email" ? "📧" : "📱"}
                      </span>
                      <span className="text-sm text-white">
                        {ch.type === "email"
                          ? ch.value
                          : ch.value.replace(/(\d{2})(\d{2})(\d{5})(\d{4})/, "+$1 ($2) $3-$4")}
                      </span>
                      {ch.verified
                        ? (
                          <span className="text-xs bg-[var(--color-primary-green)]/20 text-[var(--color-primary-green)] px-2 py-0.5 rounded-full">
                            ✅ {t("common.recoveryChannels.verified")}
                          </span>
                        )
                        : (
                          <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full">
                            ⚠️ {t("common.recoveryChannels.unverified")}
                          </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                      {!ch.verified && (
                        <button
                          type="button"
                          onClick={() => handleResendVerification(String(ch.id))}
                          disabled={resendingId === String(ch.id)}
                          className="text-xs text-[var(--color-secondary-blue)] hover:text-[var(--color-primary-green)] transition-colors disabled:opacity-50 flex items-center gap-1"
                        >
                          {resendingId === String(ch.id) && <Spinner size="sm" className="border-[var(--color-secondary-blue)] border-t-transparent" />}
                          {t("common.recoveryChannels.resendVerification")}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemoveChannel(String(ch.id))}
                        disabled={deletingId === String(ch.id)}
                        className="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-50 flex items-center gap-1"
                      >
                        {deletingId === String(ch.id) && <Spinner size="sm" className="border-red-400 border-t-transparent" />}
                        {t("common.recoveryChannels.remove")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

        {/* Add channel form */}
        {channels.length < MAX_CHANNELS && (
          <form onSubmit={handleAddChannel} className="flex flex-col sm:flex-row gap-3">
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
              {addingChannel && <Spinner size="sm" className="border-black border-t-transparent" />}
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
    </div>
  );
}
