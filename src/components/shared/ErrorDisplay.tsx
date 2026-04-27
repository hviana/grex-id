"use client";
import { useTenantContext } from "@/src/hooks/useTenantContext";

interface ErrorDisplayProps {
  message: string | null;
  errors?: string[];
}

export default function ErrorDisplay({ message, errors }: ErrorDisplayProps) {
  const { t } = useTenantContext();

  if (!message && (!errors || errors.length === 0)) return null;

  return (
    <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400 space-y-1">
      {message && <p>{t(message)}</p>}
      {errors && errors.length > 0 && (
        <ul className="list-disc list-inside space-y-0.5">
          {errors.map((err, i) => <li key={i}>{t(err)}</li>)}
        </ul>
      )}
    </div>
  );
}
