"use client";

import { useRef, useState } from "react";
import { useLocale } from "@/src/hooks/useLocale";
import Spinner from "@/src/components/shared/Spinner";
import Modal from "@/src/components/shared/Modal";

const MIME_TO_EXT: Record<string, string> = {
  "image/webp": ".webp",
};

interface TransformResult {
  data: Uint8Array;
  type: string;
}

interface FileUploadFieldProps {
  fieldName: string;
  allowedExtensions: string[];
  maxSizeBytes: number;
  companyId: string;
  systemSlug: string;
  userId: string;
  category: string[];
  previewEnabled?: boolean;
  descriptionEnabled?: boolean;
  currentUri?: string;
  transformFn?: (file: File) => Promise<TransformResult>;
  onComplete: (uri: string) => void;
  onRemove?: () => void;
}

export default function FileUploadField({
  fieldName,
  allowedExtensions,
  maxSizeBytes,
  companyId,
  systemSlug,
  userId,
  category,
  previewEnabled = false,
  descriptionEnabled = false,
  currentUri,
  transformFn,
  onComplete,
  onRemove,
}: FileUploadFieldProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const { t } = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);

    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      setError("common.error.file.invalidExtension");
      return;
    }

    if (file.size > maxSizeBytes) {
      setError("common.error.file.tooLarge");
      return;
    }

    if (previewEnabled && file.type.startsWith("image/")) {
      setPreviewUrl(URL.createObjectURL(file));
    }

    setUploading(true);
    setProgress(0);

    try {
      let uploadFile = file;
      if (transformFn) {
        const { data, type } = await transformFn(file);
        const ext = MIME_TO_EXT[type];
        if (!ext) {
          setError("common.error.file.invalidExtension");
          return;
        }
        const baseName = file.name.replace(/\.[^.]+$/, "");
        const blob = new Blob([data], { type });
        uploadFile = new File([blob], `${baseName}${ext}`, { type });
      }

      const formData = new FormData();
      formData.append("file", uploadFile);
      formData.append("companyId", companyId);
      formData.append("systemSlug", systemSlug);
      formData.append("userId", userId);
      formData.append("category", JSON.stringify(category));
      if (description) formData.append("description", description);

      // Simulate progress
      const progressInterval = setInterval(() => {
        setProgress((p) => Math.min(p + 10, 90));
      }, 200);

      const headers: Record<string, string> = {};
      const tokenMatch = document.cookie.match(
        /(?:^|; )core_token=([^;]*)/,
      );
      if (tokenMatch?.[1]) {
        headers["Authorization"] = `Bearer ${tokenMatch[1]}`;
      }

      const res = await fetch("/api/files/upload", {
        method: "POST",
        headers,
        body: formData,
      });

      clearInterval(progressInterval);
      setProgress(100);

      const json = await res.json();
      if (json.success) {
        setPreviewUrl(null);
        onComplete(json.data.uri);
      } else {
        setError(json.error?.message ?? "common.error.file.uploadFailed");
      }
    } catch {
      setError("common.error.file.uploadFailed");
    } finally {
      setUploading(false);
    }
  };

  const displayUri = currentUri || null;

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-[var(--color-light-text)]">
        {fieldName}
      </label>

      {previewEnabled && previewUrl && (
        <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-[var(--color-primary-green)]/30">
          <img
            src={previewUrl}
            alt="Preview"
            className="w-full h-full object-cover"
          />
        </div>
      )}

      {previewEnabled && !previewUrl && displayUri && (
        <div className="flex items-center gap-3">
          <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-[var(--color-primary-green)]/30">
            <img
              src={`/api/files/download?uri=${encodeURIComponent(displayUri)}`}
              alt="Preview"
              className="w-full h-full object-cover"
            />
          </div>
          {onRemove && (
            <button
              type="button"
              onClick={() => setConfirmRemove(true)}
              className="text-xs text-red-400 hover:text-red-300 hover:bg-red-400/10 rounded-full px-2 py-1 transition-all"
            >
              ✕ {t("common.delete")}
            </button>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="rounded-lg border border-[var(--color-dark-gray)] px-4 py-2 text-sm text-[var(--color-light-text)] hover:border-[var(--color-primary-green)] transition-colors disabled:opacity-50"
        >
          {uploading ? <Spinner size="sm" /> : `📎 ${t("common.file.choose")}`}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={allowedExtensions.join(",")}
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {uploading && (
        <div className="w-full bg-[var(--color-dark-gray)] rounded-full h-2">
          <div
            className="bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] h-2 rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {descriptionEnabled && (
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("common.file.description")}
          className="w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors"
        />
      )}

      {error && <p className="text-xs text-red-400">{t(error)}</p>}

      {confirmRemove && (
        <Modal
          open
          onClose={() => setConfirmRemove(false)}
          title={t("common.file.removeTitle")}
        >
          <p className="text-sm text-[var(--color-light-text)] mb-4">
            {t("common.file.removeConfirm")}
          </p>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setConfirmRemove(false)}
              className="rounded-lg border border-[var(--color-dark-gray)] px-4 py-2 text-sm text-[var(--color-light-text)] hover:bg-white/5 transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmRemove(false);
                onRemove?.();
              }}
              className="rounded-lg bg-red-500/80 px-4 py-2 text-sm text-white hover:bg-red-500 transition-colors"
            >
              {t("common.delete")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
