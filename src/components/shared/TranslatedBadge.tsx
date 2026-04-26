"use client";

import { useLocale } from "@/src/hooks/useLocale";

export type TranslatedBadgeKind =
  | "role"
  | "entity"
  | "resource";

const KIND_SEGMENT: Record<TranslatedBadgeKind, string> = {
  role: "roles",
  entity: "entities",
  resource: "resources",
};

// Tailwind-only palette per kind, using the project's CSS variables (§4) as
// the color source. Each entry is a set of utility classes that combine into
// a tinted-glassmorphism pill consistent with the visual standard.
const KIND_CLASSES: Record<
  TranslatedBadgeKind,
  { container: string; translation: string }
> = {
  role: {
    container:
      "border-[var(--color-primary-green)]/40 bg-[var(--color-primary-green)]/10 text-[var(--color-primary-green)]",
    translation: "text-[var(--color-primary-green)]",
  },
  entity: {
    container:
      "border-[var(--color-light-green)]/40 bg-[var(--color-light-green)]/10 text-[var(--color-light-green)]",
    translation: "text-[var(--color-light-green)]",
  },
  resource: {
    container:
      "border-[var(--color-secondary-blue)]/40 bg-[var(--color-secondary-blue)]/10 text-[var(--color-secondary-blue)]",
    translation: "text-[var(--color-secondary-blue)]",
  },
};

interface TranslatedBadgeProps {
  kind: TranslatedBadgeKind;
  token: string;
  systemSlug?: string;
  frameworkName?: string;
  onRemove?: () => void;
  /**
   * Human mode — renders ONLY the translation, hiding the raw token. Use on
   * end-user surfaces (plan cards, usage panel, OAuth consent). Operator
   * surfaces (forms, admin lists, token cards) must omit this prop so both
   * the raw token and the translation are visible (§2.3.1).
   */
  compact?: boolean;
}

/**
 * Compact badge that resolves a role / permission / entity / resource token
 * into its translation via the standard i18n structure (§5.6.1). Default mode
 * renders the raw token and its translation stacked vertically so operators
 * see both. `compact` mode collapses to the translation alone — for surfaces
 * read by end users who lack technical context.
 */
export default function TranslatedBadge({
  kind,
  token,
  systemSlug,
  frameworkName,
  onRemove,
  compact = false,
}: TranslatedBadgeProps) {
  const { t } = useLocale();
  const segment = KIND_SEGMENT[kind];
  const palette = KIND_CLASSES[kind];

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

  const baseContainer =
    `inline-flex items-center gap-2 rounded-full border px-3 py-1 ${palette.container}`;

  // Human mode: show the translation only. If no translation exists the raw
  // token is the only available label, so we render that instead.
  if (compact) {
    return (
      <span className={`${baseContainer} text-xs`}>
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
    <span className={baseContainer}>
      <span className="flex flex-col leading-tight">
        <span className="font-mono text-xs text-white">{token}</span>
        {translated && (
          <span className={`text-[10px] ${palette.translation}`}>
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
