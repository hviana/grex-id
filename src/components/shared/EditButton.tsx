"use client";

import { useLocale } from "@/src/hooks/useLocale";
import Spinner from "./Spinner.tsx";

interface EditButtonProps {
  onClick: () => void;
  loading?: boolean;
}

export default function EditButton({ onClick, loading }: EditButtonProps) {
  const { t } = useLocale();
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="rounded-lg border border-[var(--color-dark-gray)] px-3 py-1.5 text-sm text-[var(--color-secondary-blue)] hover:border-[var(--color-secondary-blue)] transition-colors disabled:opacity-50"
      title={t("common.edit")}
    >
      {loading ? <Spinner size="sm" /> : "✏️"}
    </button>
  );
}
