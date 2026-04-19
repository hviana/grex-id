"use client";

"use client";

import { useLocale } from "@/src/hooks/useLocale";

interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeClasses = {
  sm: "h-4 w-4 border-2",
  md: "h-8 w-8 border-2",
  lg: "h-12 w-12 border-3",
};

export default function Spinner({ size = "md", className }: SpinnerProps) {
  const { t } = useLocale();
  return (
    <div
      className={`${sizeClasses[size]} animate-spin rounded-full ${
        className ?? "border-[var(--color-primary-green)] border-t-transparent"
      }`}
      role="status"
      aria-label={t("common.loading")}
    />
  );
}
