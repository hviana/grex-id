"use client";

import { useLocale } from "@/src/hooks/useLocale";

export type TranslatedBadgeKind =
  | "role"
  | "permission"
  | "entity"
  | "resource";

const KIND_SEGMENT: Record<TranslatedBadgeKind, string> = {
  role: "roles",
  permission: "permissions",
  entity: "entities",
  resource: "resources",
};

const KIND_PALETTE: Record<TranslatedBadgeKind, string> = {
  role: "var(--color-primary-green)",
  permission: "var(--color-secondary-blue)",
  entity: "var(--color-light-green)",
  resource: "var(--color-secondary-blue)",
};

interface TranslatedBadgeProps {
  kind: TranslatedBadgeKind;
  token: string;
  systemSlug?: string;
  frameworkName?: string;
  color?: string;
  onRemove?: () => void;
  /**
   * Human mode — renders ONLY the translation, hiding the raw token. Use on
   * end-user surfaces (plan cards, usage panel, OAuth consent). Operator
   * surfaces (forms, admin lists, token cards) must omit this prop so both
   * the raw token and the translation are visible (§18.1.2).
   */
  compact?: boolean;
}

/**
 * Compact badge that resolves a role / permission / entity / resource token
 * into its translation via the standard i18n structure (§5.6.1). Default mode
 * renders the raw token and its translation stacked vertically so operators
 * see both. `compact` mode collapses to the translation alone — for
 * surfaces read by end users who lack technical context.
 */
export default function TranslatedBadge({
  kind,
  token,
  systemSlug,
  frameworkName,
  color,
  onRemove,
  compact = false,
}: TranslatedBadgeProps) {
  const { t } = useLocale();
  const segment = KIND_SEGMENT[kind];

  function resolve(prefix: string): string | null {
    const key = `${prefix}.${token}`;
    const translation = t(key);
    // t() returns the key itself when the translation is missing.
    return translation === key ? null : translation;
  }

  const candidates: string[] = [];
  if (systemSlug) candidates.push(`systems.${systemSlug}.${segment}`);
  if (frameworkName) candidates.push(`frameworks.${frameworkName}.${segment}`);
  candidates.push(segment);

  let translated: string | null = null;
  for (const prefix of candidates) {
    translated = resolve(prefix);
    if (translated) break;
  }

  const accent = color ?? KIND_PALETTE[kind];
  const swatchBg = `${accent}1a`; // ~10% alpha
  const swatchBorder = `${accent}55`;

  // Human mode: show the translation only. If no translation exists the raw
  // token is the only available label, so we render that instead.
  if (compact) {
    return (
      <span
        className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs"
        style={{
          backgroundColor: swatchBg,
          borderColor: swatchBorder,
          color: accent,
        }}
      >
        <span className="text-white">{translated ?? token}</span>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="ml-1 rounded-full px-1 text-xs text-white/70 transition-colors hover:text-white"
            aria-label="Remove"
          >
            ✕
          </button>
        )}
      </span>
    );
  }

  // Default: raw token + translated label stacked vertically.
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border px-3 py-1"
      style={{
        backgroundColor: swatchBg,
        borderColor: swatchBorder,
        color: accent,
      }}
    >
      <span className="flex flex-col leading-tight">
        <span className="font-mono text-xs text-white">{token}</span>
        {translated && (
          <span
            className="text-[10px]"
            style={{ color: "var(--color-light-text)" }}
          >
            {translated}
          </span>
        )}
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-1 rounded-full px-1 text-xs text-white/70 transition-colors hover:text-white"
          aria-label="Remove"
        >
          ✕
        </button>
      )}
    </span>
  );
}
