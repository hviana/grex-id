"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { ModalProps } from "@/src/contracts/high-level/component-props";

export default function Modal({ open, onClose, title, children }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto backdrop-blur-md bg-[#111]/95 border border-dashed border-[var(--color-dark-gray)] rounded-2xl p-6 shadow-xl shadow-[var(--color-light-green)]/5">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--color-light-text)] hover:text-white transition-colors text-xl"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
