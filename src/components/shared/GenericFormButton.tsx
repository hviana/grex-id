"use client";

import Spinner from "./Spinner";

interface GenericFormButtonProps {
  loading: boolean;
  label: string;
  disabled?: boolean;
}

export default function GenericFormButton(
  { loading, label, disabled }: GenericFormButtonProps,
) {
  return (
    <button
      type="submit"
      disabled={loading || disabled}
      className="w-full rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-4 py-3 font-semibold text-black transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
    >
      {loading
        ? <Spinner size="sm" className="border-black border-t-transparent" />
        : null}
      {label}
    </button>
  );
}
