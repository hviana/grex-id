"use client";

import { useCallback, useEffect, useState } from "react";
import Modal from "@/src/components/shared/Modal";
import Spinner from "@/src/components/shared/Spinner";
import ChannelActions from "@/src/components/shared/ChannelActions";
import { useTenantContext } from "@/src/hooks/useTenantContext";
import { useDebounce } from "@/src/hooks/useDebounce";
import type { UserViewData } from "@/src/contracts/high-level/user";

interface InviteUserModalProps {
  open: boolean;
  onClose: () => void;
  onInvited?: () => void;
}

export default function InviteUserModal(
  { open, onClose, onInvited }: InviteUserModalProps,
) {
  const { t, systemToken, companyId, systemId } = useTenantContext();

  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 300);
  const [results, setResults] = useState<UserViewData[]>([]);
  const [searching, setSearching] = useState(false);
  const [inviting, setInviting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const searchUsers = useCallback(
    async (q: string) => {
      if (!systemToken || q.length < 2) {
        setResults([]);
        return;
      }
      setSearching(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          action: "search-all",
          search: q,
          limit: "20",
        });
        const res = await fetch(`/api/users?${params}`, {
          headers: { Authorization: `Bearer ${systemToken}` },
        });
        const json = await res.json();
        setResults((json.items ?? []) as UserViewData[]);
      } catch {
        setError("common.error.network");
      } finally {
        setSearching(false);
      }
    },
    [systemToken],
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setError(null);
      setSuccessMsg(null);
      return;
    }
    searchUsers(debouncedQuery);
  }, [debouncedQuery, open, searchUsers]);

  const handleInvite = async (user: UserViewData) => {
    if (!systemToken || !companyId || !systemId) return;
    const verifiedChannels = (user.channelIds ?? []).filter((c) => c.verified);
    if (verifiedChannels.length === 0) return;

    setInviting(user.id);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({
          name: user.profileId?.name ?? "",
          channels: verifiedChannels.map((c) => ({
            type: c.type,
            value: c.value,
          })),
          companyId,
          systemId,
          roles: [],
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(
          json.error?.errors?.map((e: string) => t(e)).join(", ") ??
            json.error?.message ?? "common.error.generic",
        );
        return;
      }
      setSuccessMsg(t("common.users.inviteExisting"));
      onInvited?.();
    } catch {
      setError("common.error.network");
    } finally {
      setInviting(null);
    }
  };

  const formatChannels = (user: UserViewData) => {
    return (user.channelIds ?? []).map((c) => ({
      type: c.type,
      value: c.value,
    }));
  };

  const userDisplayName = (user: UserViewData) =>
    user.profileId?.name ??
      (user.channelIds ?? [])[0]?.value ??
      t("common.lead.unknown");

  return (
    <Modal open={open} onClose={onClose} title={t("common.users.invite")}>
      <div className="space-y-4">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("common.users.inviteSearchPlaceholder")}
          className="w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors"
        />

        {error && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {successMsg && (
          <div className="rounded-lg bg-[var(--color-primary-green)]/10 border border-[var(--color-primary-green)]/30 p-3 text-sm text-[var(--color-primary-green)]">
            {successMsg}
          </div>
        )}

        {searching && (
          <div className="flex justify-center py-8">
            <Spinner size="lg" />
          </div>
        )}

        {!searching && debouncedQuery.length >= 2 && results.length === 0 && (
          <div className="text-center py-8 text-sm text-[var(--color-light-text)]">
            {t("common.noResults")}
          </div>
        )}

        {!searching && results.length > 0 && (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {results.map((user) => (
              <div
                key={user.id}
                className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-dashed border-[var(--color-dark-gray)] bg-white/5 backdrop-blur-md p-4 transition-all hover:border-[var(--color-primary-green)]/30 hover:bg-white/[0.07]"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] flex items-center justify-center text-xs font-bold text-black shrink-0">
                      {userDisplayName(user).charAt(0).toUpperCase()}
                    </div>
                    <span className="text-sm font-medium text-white truncate">
                      {userDisplayName(user)}
                    </span>
                  </div>
                  <div className="ml-10">
                    <ChannelActions
                      channels={formatChannels(user)}
                      actions={["whatsapp", "email"]}
                    />
                  </div>
                </div>

                <button
                  onClick={() => handleInvite(user)}
                  disabled={inviting === user.id}
                  className="shrink-0 rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-4 py-2 text-sm font-semibold text-black transition-all hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
                >
                  {inviting === user.id && (
                    <Spinner
                      size="sm"
                      className="border-black border-t-transparent"
                    />
                  )}
                  {t("common.users.inviteSend")}
                </button>
              </div>
            ))}
          </div>
        )}

        {!searching && debouncedQuery.length < 2 && (
          <div className="text-center py-8 text-sm text-[var(--color-light-text)]/60">
            {t("common.users.inviteSearchPlaceholder")}
          </div>
        )}
      </div>
    </Modal>
  );
}
