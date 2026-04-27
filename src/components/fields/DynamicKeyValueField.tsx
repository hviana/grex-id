"use client";
import { useTenantContext } from "@/src/hooks/useTenantContext";


interface KeyValueEntry {
  key: string;
  value: string;
  description: string;
}

interface DynamicKeyValueFieldProps {
  fields: KeyValueEntry[];
  onChange: (fields: KeyValueEntry[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  descriptionPlaceholder?: string;
  addLabel?: string;
  showDescription?: boolean;
}

export default function DynamicKeyValueField(
  {
    fields,
    onChange,
    keyPlaceholder,
    valuePlaceholder,
    descriptionPlaceholder,
    addLabel,
    showDescription = true,
  }: DynamicKeyValueFieldProps,
) {
  const { t } = useTenantContext();

  const update = (idx: number, patch: Partial<KeyValueEntry>) => {
    const next = fields.map((f, i) => (i === idx ? { ...f, ...patch } : f));
    onChange(next);
  };

  const add = () =>
    onChange([...fields, { key: "", value: "", description: "" }]);
  const remove = (idx: number) => onChange(fields.filter((_, i) => i !== idx));

  const inputCls =
    "w-full rounded border border-[var(--color-dark-gray)] bg-white/5 px-3 py-1.5 text-sm text-white outline-none focus:border-[var(--color-primary-green)] transition-colors placeholder-white/30";

  return (
    <div className="space-y-3">
      {fields.map((field, idx) => (
        <div
          key={idx}
          className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-lg p-3 space-y-2"
        >
          <div className="flex gap-2">
            <input
              type="text"
              value={field.key}
              onChange={(e) => update(idx, { key: e.target.value })}
              placeholder={keyPlaceholder ?? t("common.field.key")}
              className={inputCls}
            />
            <button
              type="button"
              onClick={() => remove(idx)}
              className="text-red-400 hover:text-red-300 px-2 shrink-0"
            >
              🗑️
            </button>
          </div>
          <input
            type="text"
            value={field.value}
            onChange={(e) => update(idx, { value: e.target.value })}
            placeholder={valuePlaceholder ?? t("common.field.value")}
            className={inputCls}
          />
          {showDescription && (
            <input
              type="text"
              value={field.description}
              onChange={(e) => update(idx, { description: e.target.value })}
              placeholder={descriptionPlaceholder ??
                t("common.field.description")}
              className={inputCls}
            />
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="text-sm text-[var(--color-secondary-blue)] hover:text-[var(--color-primary-green)] transition-colors"
      >
        ➕ {addLabel ?? t("common.addEntry")}
      </button>
    </div>
  );
}
