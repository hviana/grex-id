"use client";

import type { PublicSystemInfo } from "@/src/contracts/high-level/systems";
import Spinner from "./Spinner.tsx";
import type { SystemBrandingProps } from "@/src/contracts/high-level/component-props";

export default function SystemBranding(
  { systemInfo, loading }: SystemBrandingProps,
) {
  if (loading) {
    return (
      <div className="flex justify-center mb-6">
        <Spinner size="sm" />
      </div>
    );
  }

  if (!systemInfo) return null;

  return (
    <div className="flex flex-col items-center gap-4 mb-8">
      {systemInfo.logoUri
        ? (
          <img
            src={`/api/files/download?uri=${
              encodeURIComponent(systemInfo.logoUri)
            }`}
            alt={systemInfo.name}
            className="h-32 w-32 rounded-2xl object-contain"
          />
        )
        : (
          <span className="text-2xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
            {systemInfo.name}
          </span>
        )}
    </div>
  );
}
