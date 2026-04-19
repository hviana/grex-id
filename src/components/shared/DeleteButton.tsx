"use client";

import { useState } from "react";
import { useLocale } from "@/src/hooks/useLocale";
import Modal from "./Modal.tsx";
import Spinner from "./Spinner.tsx";

interface DeleteButtonProps {
  onConfirm: () => Promise<void>;
}

export default function DeleteButton({ onConfirm }: DeleteButtonProps) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    setLoading(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-[var(--color-dark-gray)] px-3 py-1.5 text-sm text-red-400 hover:border-red-400 transition-colors"
        title={t("common.delete")}
      >
        🗑️
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t("common.confirm.delete.title")}
      >
        <p className="text-[var(--color-light-text)] mb-6">
          {t("common.confirm.delete.message")}
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={() => setOpen(false)}
            className="rounded-lg border border-[var(--color-dark-gray)] px-4 py-2 text-sm text-[var(--color-light-text)] hover:border-white transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleDelete}
            disabled={loading}
            className="rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {loading
              ? (
                <Spinner
                  size="sm"
                  className="border-white border-t-transparent"
                />
              )
              : null}
            {t("common.delete")}
          </button>
        </div>
      </Modal>
    </>
  );
}
