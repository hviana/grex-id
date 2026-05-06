"use client";

export interface ToggleFieldProps {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}

export default function ToggleField({ on, onChange, label }: ToggleFieldProps) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <div
        className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${
          on ? "bg-[var(--color-primary-green)]" : "bg-white/10"
        }`}
        onClick={() => onChange(!on)}
      >
        <div
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
            on ? "left-5" : "left-0.5"
          }`}
        />
      </div>
      <span className="text-sm text-white">{label}</span>
    </label>
  );
}
