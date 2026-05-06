"use client";

import { useEffect, useRef, useState } from "react";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import GenericFormButton from "@/src/components/shared/GenericFormButton";
import FileUploadField from "@/src/components/fields/FileUploadField";
import DateSubForm from "@/src/components/subforms/DateSubForm";
import EntityChannelsSubform from "@/src/components/subforms/EntityChannelsSubform";
import PasswordChangeSubform from "@/src/components/subforms/PasswordChangeSubform";
import TwoFactorSubform from "@/src/components/subforms/TwoFactorSubform";
import { useTenantContext } from "@/src/hooks/useTenantContext";
import type { SubformRef } from "@/src/contracts/high-level/components";

export default function ProfilePage() {
  const { user, systemToken, refresh } = useTenantContext();
  const { t } = useTenantContext();
  const { companyId, systemSlug } = useTenantContext();

  const [name, setName] = useState(user?.profile?.name ?? "");
  const [avatarUri, setAvatarUri] = useState(user?.profile?.avatarUri ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const dobRef = useRef<SubformRef>(null);

  useEffect(() => {
    if (user) {
      setName(user.profile?.name ?? "");
      setAvatarUri(user.profile?.avatarUri ?? "");
    }
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const dobData = dobRef.current?.getData() ?? {};
      const res = await fetch("/api/users?action=profile", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({
          name,
          avatarUri: avatarUri || undefined,
          dateOfBirth: dobData.date || undefined,
        }),
      });
      const json = await res.json();

      if (!json.success) {
        const msg = json.error?.errors?.[0] ?? json.error?.message ??
          "common.error.generic";
        setError(msg);
      } else {
        setSuccess(true);
        await refresh();
        setTimeout(() => setSuccess(false), 3000);
      }
    } catch {
      setError("common.error.network");
    } finally {
      setSaving(false);
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

      <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-2xl p-6 hover:shadow-lg hover:shadow-[var(--color-light-green)]/20 transition-all duration-300">
        <ErrorDisplay message={error} />

        {success && (
          <div className="mb-4 rounded-lg bg-[var(--color-primary-green)]/10 border border-[var(--color-primary-green)]/30 px-4 py-3 text-sm text-[var(--color-primary-green)]">
            {t("common.profile.saved")}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
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
                category={["avatars"]}
                previewEnabled={false}
                onComplete={(uri) => setAvatarUri(uri)}
              />
            )}
          </div>

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

          <DateSubForm
            ref={dobRef}
            mode="date"
            initialDate={user?.profile?.dateOfBirth as string | undefined}
            label={t("common.profile.dateOfBirth")}
          />

          <GenericFormButton
            loading={saving}
            label={t("common.save")}
            disabled={!name.trim()}
          />
        </form>
      </div>

      <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-2xl p-6 hover:shadow-lg hover:shadow-[var(--color-light-green)]/20 transition-all duration-300">
        <h2 className="text-lg font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent mb-2">
          {t("common.entityChannels.title")}
        </h2>
        <EntityChannelsSubform
          channelTypes={["email", "phone"]}
          requiredTypes={["email"]}
          systemToken={systemToken ?? undefined}
        />
      </div>

      <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-2xl p-6 hover:shadow-lg hover:shadow-[var(--color-light-green)]/20 transition-all duration-300">
        <h2 className="text-lg font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent mb-2">
          {t("auth.passwordChange.title")}
        </h2>
        <PasswordChangeSubform />
      </div>

      <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-2xl p-6 hover:shadow-lg hover:shadow-[var(--color-light-green)]/20 transition-all duration-300">
        <h2 className="text-lg font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent mb-2">
          {t("common.twoFactor.title")}
        </h2>
        <TwoFactorSubform
          twoFactorEnabled={user.twoFactorEnabled ?? false}
          onRequested={() => {
            void refresh();
          }}
        />
      </div>
    </div>
  );
}
