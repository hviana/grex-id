"use client";
import { useEffect, useRef, useState } from "react";
import { useTenantContext } from "@/src/hooks/useTenantContext";
import type { ChannelActionsProps } from "@/src/contracts/high-level/component-props";
import type { EntityChannel } from "@/src/contracts/entity-channel";

function iconForAction(action: string): string {
  if (action === "whatsapp") return "💬";
  if (action === "email") return "📧";
  return "📡";
}

function channelMatchesAction(channel: EntityChannel, action: string): boolean {
  if (action === "whatsapp") return channel.type === "phone";
  if (action === "email") return channel.type === "email";
  return false;
}

function buildHref(action: string, value: string): string {
  if (action === "whatsapp") {
    const digits = value.replace(/\D/g, "");
    return `https://wa.me/${digits}`;
  }
  if (action === "email") return `mailto:${value}`;
  return "#";
}

interface ActionDropdownProps {
  action: string;
  channels: EntityChannel[];
  label: string;
  onClose: () => void;
}

function ActionDropdown(
  { action, channels, label, onClose }: ActionDropdownProps,
) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute top-full left-0 mt-1.5 z-10 min-w-[12rem] rounded-xl border border-dashed border-[var(--color-dark-gray)] bg-black/90 backdrop-blur-md p-1.5 shadow-lg shadow-[var(--color-light-green)]/10"
    >
      {channels.map((ch) => (
        <a
          key={ch.id}
          href={buildHref(action, ch.value)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onClose}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white"
        >
          <span className="text-base">{iconForAction(action)}</span>
          <span className="truncate">{ch.value}</span>
          <span className="ml-auto text-white/30">↗</span>
        </a>
      ))}
    </div>
  );
}

export default function ChannelActions(
  { channels, actions }: ChannelActionsProps,
) {
  const { t } = useTenantContext();
  const [openAction, setOpenAction] = useState<string | null>(null);

  const actionable = actions.filter((action) =>
    channels.some((ch) => channelMatchesAction(ch as EntityChannel, action))
  );

  if (!actionable.length) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {actionable.map((action) => {
        const matched = channels.filter((ch) =>
          channelMatchesAction(ch as EntityChannel, action)
        );
        const isOpen = openAction === action;
        const single = matched.length === 1;

        if (single) {
          return (
            <a
              key={action}
              href={buildHref(action, matched[0].value)}
              target="_blank"
              rel="noopener noreferrer"
              className="relative inline-flex items-center gap-1.5 rounded-lg border border-dashed border-[var(--color-dark-gray)] bg-white/5 backdrop-blur-md px-3.5 py-2 text-sm font-medium text-white/80 transition-all hover:-translate-y-0.5 hover:border-[var(--color-light-green)]/40 hover:bg-white/10 hover:text-white hover:shadow-lg hover:shadow-[var(--color-light-green)]/10"
            >
              <span className="text-base">{iconForAction(action)}</span>
              <span>{t(`common.channelActions.${action}`)}</span>
              <span className="text-white/25">↗</span>
            </a>
          );
        }

        return (
          <div key={action} className="relative">
            <button
              onClick={() => setOpenAction(isOpen ? null : action)}
              className="relative inline-flex items-center gap-1.5 rounded-lg border border-dashed border-[var(--color-dark-gray)] bg-white/5 backdrop-blur-md px-3.5 py-2 text-sm font-medium text-white/80 transition-all hover:-translate-y-0.5 hover:border-[var(--color-light-green)]/40 hover:bg-white/10 hover:text-white hover:shadow-lg hover:shadow-[var(--color-light-green)]/10"
            >
              <span className="text-base">{iconForAction(action)}</span>
              <span>{t(`common.channelActions.${action}`)}</span>
              <span className="text-white/25">{isOpen ? "▴" : "▾"}</span>
            </button>
            {isOpen && (
              <ActionDropdown
                action={action}
                channels={matched as EntityChannel[]}
                label={t(`common.channelActions.${action}`)}
                onClose={() => setOpenAction(null)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
