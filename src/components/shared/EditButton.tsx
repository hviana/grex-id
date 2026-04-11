"use client";

import Spinner from "./Spinner";

interface EditButtonProps {
  onClick: () => void;
  loading?: boolean;
}

export default function EditButton({ onClick, loading }: EditButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="rounded-lg border border-[var(--color-dark-gray)] px-3 py-1.5 text-sm text-[var(--color-secondary-blue)] hover:border-[var(--color-secondary-blue)] transition-colors disabled:opacity-50"
      title="Edit"
    >
      {loading ? <Spinner size="sm" /> : "✏️"}
    </button>
  );
}
