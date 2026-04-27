"use client";
import { useTenantContext } from "@/src/hooks/useTenantContext";


interface CreateButtonProps {
  onClick: () => void;
  label?: string;
}

export default function CreateButton({ onClick, label }: CreateButtonProps) {
  const { t } = useTenantContext();

  return (
    <button
      onClick={onClick}
      className="rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-4 py-2 text-sm font-semibold text-black transition-all hover:opacity-90 flex items-center gap-1"
    >
      <span>➕</span>
      {label ?? t("common.create")}
    </button>
  );
}
