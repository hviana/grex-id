"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import type { SubformRef } from "@/src/contracts/high-level/components";
import FileUploadField from "@/src/components/fields/FileUploadField";
import DateSubForm from "@/src/components/subforms/DateSubForm";
import { resizeImage } from "@/src/lib/resize-image";
import { useTenantContext } from "@/src/hooks/useTenantContext";
import type { ProfileSubformProps } from "@/src/contracts/high-level/component-props";

const ProfileSubform = forwardRef<SubformRef, ProfileSubformProps>(
  ({ initialData, companyId, systemSlug, hideAvatar }, ref) => {
    const { t } = useTenantContext();
    const profile = (initialData?.profileId as Record<string, unknown>) ?? {};

    const [name, setName] = useState((profile.name as string) ?? "");
    const [avatarUri, setAvatarUri] = useState(
      (profile.avatarUri as string) ?? "",
    );
    const dobRef = useRef<SubformRef>(null);

    useImperativeHandle(ref, () => ({
      getData: () => {
        const dobData = dobRef.current?.getData() ?? {};
        return {
          profile: {
            name,
            avatarUri: avatarUri || undefined,
            dateOfBirth: dobData.date || undefined,
          },
        };
      },
      isValid: () => name.trim().length > 0,
    }));

    return (
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
            {t("auth.register.name")} *
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
        {!hideAvatar && companyId && systemSlug
          ? (
            <FileUploadField
              fieldName={t("common.profile.avatar")}
              allowedExtensions={[".svg", ".png", ".jpg", ".jpeg", ".webp"]}
              maxSizeBytes={2097152}
              companyId={companyId}
              systemSlug={systemSlug}
              category={["avatars"]}
              previewEnabled
              transformFn={async (file) => {
                const data = await resizeImage(file, {
                  width: 128,
                  format: "image/webp",
                });
                return { data, type: "image/webp" };
              }}
              onComplete={(uri) => setAvatarUri(uri)}
            />
          )
          : null}
        {!hideAvatar && avatarUri && (
          <div className="flex items-center gap-3">
            <img
              src={`/api/files/download?uri=${encodeURIComponent(avatarUri)}`}
              alt={t("common.profile.avatar")}
              className="w-12 h-12 rounded-full border border-[var(--color-dark-gray)] object-cover"
            />
            <button
              type="button"
              onClick={() => setAvatarUri("")}
              className="text-xs text-red-400 hover:text-red-300"
            >
              ✕
            </button>
          </div>
        )}
        <DateSubForm
          ref={dobRef}
          mode="date"
          initialDate={profile.dateOfBirth as string | undefined}
          label={t("common.profile.dateOfBirth")}
        />
      </div>
    );
  },
);

ProfileSubform.displayName = "ProfileSubform";
export default ProfileSubform;
