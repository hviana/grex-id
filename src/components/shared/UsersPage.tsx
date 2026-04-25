"use client";

import { useCallback, useRef, useState } from "react";
import { useLocale } from "@/src/hooks/useLocale";
import { useAuth } from "@/src/hooks/useAuth";
import { useSystemContext } from "@/src/hooks/useSystemContext";
import GenericList from "@/src/components/shared/GenericList";
import Modal from "@/src/components/shared/Modal";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import MultiBadgeField from "@/src/components/fields/MultiBadgeField";
import TranslatedBadge from "@/src/components/shared/TranslatedBadge";
import TranslatedBadgeList from "@/src/components/shared/TranslatedBadgeList";
import EntityChannelsSubform from "@/src/components/subforms/EntityChannelsSubform";
import type { SubformRef } from "@/src/components/shared/GenericList";
import type { CursorParams, PaginatedResult } from "@/src/contracts/common";

interface ChannelRow {
  id: string;
  type: string;
  value: string;
  verified: boolean;
}

interface UserItem {
  id: string;
  profileId?: {
    name: string;
    avatarUri?: string;
  };
  channelIds?: ChannelRow[];
  roles: string[];
  contextRoles?: string[];
  createdAt: string;
  [key: string]: unknown;
}

function primaryChannelLabel(user: UserItem): string {
  const email = (user.channelIds ?? []).find((c) => c.type === "email");
  if (email?.value) return email.value;
  const verified = (user.channelIds ?? []).find((c) => c.verified);
  if (verified?.value) return verified.value;
  return (user.channelIds ?? [])[0]?.value ?? "";
}

export default function UsersPage() {
  const { t } = useLocale();
  const { systemToken } = useAuth();
  const { companyId, systemId, systemSlug, roles: myRoles } =
    useSystemContext();

  const isAdmin = myRoles.includes("admin") || myRoles.includes("superuser");

  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserItem | null>(null);
  const [deleteUser, setDeleteUser] = useState<UserItem | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const newChannelsRef = useRef<SubformRef>(null);
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRoles, setNewRoles] = useState<string[]>([]);

  const [editName, setEditName] = useState("");
  const [editRoles, setEditRoles] = useState<string[]>([]);

  const fetchSystemRoles = useCallback(async (search: string) => {
    if (!systemId) return [];
    try {
      const res = await fetch(
        `/api/core/roles?systemId=${encodeURIComponent(systemId)}&limit=100`,
      );
      const json = await res.json();
      const roles: { name: string }[] = json.data ?? [];
      const lower = search.toLowerCase();
      return roles
        .map((r) => r.name)
        .filter((name) => name.toLowerCase().includes(lower));
    } catch {
      return [];
    }
  }, [systemId]);

  const fetchUsers = useCallback(
    async (
      params: CursorParams & { search?: string },
    ): Promise<PaginatedResult<UserItem>> => {
      if (!systemToken || !companyId || !systemId) {
        return { data: [], nextCursor: null, prevCursor: null };
      }
      const p = new URLSearchParams({
        limit: String(params.limit),
        companyId,
        systemId,
      });
      if (params.search) p.set("search", params.search);
      if (params.cursor) p.set("cursor", params.cursor);
      const res = await fetch(`/api/users?${p}`, {
        headers: { Authorization: `Bearer ${systemToken}` },
      });
      const json = await res.json();
      return {
        data: (json.data ?? []) as UserItem[],
        nextCursor: json.nextCursor ?? null,
        prevCursor: null,
      };
    },
    [systemToken, companyId, systemId],
  );

  const triggerReload = () => setReloadKey((k) => k + 1);

  const handleCreate = async () => {
    if (!systemToken || !companyId || !systemId) return;
    const collected = (newChannelsRef.current?.getData() ?? {}) as {
      channels?: { type: string; value: string }[];
    };
    const channels = collected.channels ?? [];
    if (channels.length === 0) {
      setError("validation.channel.required");
      return;
    }
    if (!newChannelsRef.current?.isValid()) {
      setError("validation.channel.requiredTypes");
      return;
    }
    setActionLoading(true);
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
          channels,
          password: newPassword,
          name: newName,
          companyId,
          systemId,
          roles: newRoles,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        const msg = json.error?.errors?.map((e: string) => t(e)).join(", ") ||
          json.error?.message || "common.error.generic";
        setError(msg);
        return;
      }
      setCreateOpen(false);
      setNewName("");
      setNewPassword("");
      setNewRoles([]);
      if (json.invited) {
        setSuccessMsg("common.users.inviteExisting");
      }
      triggerReload();
    } catch {
      setError("common.error.network");
    } finally {
      setActionLoading(false);
    }
  };

  const handleEdit = async () => {
    if (!systemToken || !editUser || !companyId || !systemId) return;
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/users", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({
          id: editUser.id,
          name: editName,
          companyId,
          systemId,
          roles: editRoles,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error?.message ?? "common.error.generic");
        return;
      }
      setEditUser(null);
      triggerReload();
    } catch {
      setError("common.error.network");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!systemToken || !deleteUser || !companyId || !systemId) return;
    setActionLoading(true);
    try {
      await fetch("/api/users", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({
          userId: deleteUser.id,
          companyId,
          systemId,
        }),
      });
      setDeleteUser(null);
      triggerReload();
    } catch {
      setError("common.error.network");
    } finally {
      setActionLoading(false);
    }
  };

  const openEdit = (user: UserItem) => {
    setEditUser(user);
    setEditName(user.profileId?.name ?? "");
    setEditRoles(user.contextRoles ?? user.roles);
    setError(null);
  };

  const inputCls =
    "w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-3 text-white placeholder-white/30 outline-none focus:border-[var(--color-primary-green)] transition-colors";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
          {t("common.menu.users")}
        </h1>
        {isAdmin && (
          <button
            onClick={() => {
              setCreateOpen(true);
              setError(null);
              setSuccessMsg(null);
            }}
            className="rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-4 py-2 font-semibold text-black text-sm transition-all hover:opacity-90"
          >
            {t("common.users.create")}
          </button>
        )}
      </div>

      {successMsg && (
        <div className="rounded-lg bg-[var(--color-primary-green)]/10 border border-[var(--color-primary-green)]/30 p-3 text-sm text-[var(--color-primary-green)]">
          {t(successMsg)}
        </div>
      )}

      <ErrorDisplay message={error} />

      <GenericList<UserItem>
        entityName={t("common.menu.users")}
        searchEnabled={false}
        createEnabled={false}
        controlButtons={[]}
        fetchFn={fetchUsers}
        reloadKey={reloadKey}
        renderItem={(user) => (
          <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-4 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 transition-all duration-200">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] flex items-center justify-center text-black font-bold text-sm shrink-0">
                {(user.profileId?.name ?? primaryChannelLabel(user))
                  .charAt(0)
                  .toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-white truncate">
                  {user.profileId?.name ?? primaryChannelLabel(user)}
                </h3>
                <p className="text-sm text-[var(--color-light-text)] truncate">
                  {primaryChannelLabel(user)}
                </p>
              </div>
              <TranslatedBadgeList
                kind="role"
                tokens={user.contextRoles ?? user.roles}
                systemSlug={systemSlug ?? undefined}
                className="shrink-0"
              />
              {isAdmin && (
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => openEdit(user)}
                    className="text-sm px-2 py-1 rounded border border-[var(--color-dark-gray)] text-[var(--color-light-text)] hover:bg-white/5 transition-colors"
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => setDeleteUser(user)}
                    className="text-sm px-2 py-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    🗑️
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      />

      {/* Create modal */}
      {createOpen && (
        <Modal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          title={t("common.users.create")}
        >
          <ErrorDisplay message={error} />
          <div className="space-y-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("common.placeholder.name")}
              className={inputCls}
            />
            <EntityChannelsSubform
              ref={newChannelsRef}
              mode="local"
              channelTypes={["email", "phone"]}
              requiredTypes={["email"]}
            />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={t("common.users.password")}
              className={inputCls}
            />
            <MultiBadgeField
              name={t("common.users.roles")}
              mode="search"
              value={newRoles}
              onChange={(vals) => setNewRoles(vals as string[])}
              fetchFn={fetchSystemRoles}
              formatHint={t("common.users.rolesHint")}
              renderBadge={(item, remove) => (
                <TranslatedBadge
                  kind="role"
                  token={typeof item === "string" ? item : item.name}
                  systemSlug={systemSlug ?? undefined}
                  onRemove={remove}
                />
              )}
            />
            <p className="text-xs text-[var(--color-light-text)]/60">
              {t("common.users.inviteHint")}
            </p>
            <button
              onClick={handleCreate}
              disabled={actionLoading || !newName}
              className="w-full rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-4 py-3 font-semibold text-black transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {actionLoading && (
                <Spinner
                  size="sm"
                  className="border-black border-t-transparent"
                />
              )}
              {t("common.users.create")}
            </button>
          </div>
        </Modal>
      )}

      {/* Edit modal */}
      {editUser && (
        <Modal
          open={!!editUser}
          onClose={() => setEditUser(null)}
          title={t("common.users.edit")}
        >
          <ErrorDisplay message={error} />
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-[var(--color-light-text)] mb-1">
                {t("common.entityChannels.title")}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {(editUser.channelIds ?? []).map((c) => (
                  <span
                    key={c.id}
                    className="text-xs text-[var(--color-light-text)] bg-white/5 border border-[var(--color-dark-gray)] rounded-full px-2 py-0.5"
                  >
                    {c.value}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-xs text-[var(--color-light-text)]/60">
                {t("common.users.channelsReadOnlyHint")}
              </p>
            </div>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder={t("common.placeholder.name")}
              className={inputCls}
            />
            <MultiBadgeField
              name={t("common.users.roles")}
              mode="search"
              value={editRoles}
              onChange={(vals) => setEditRoles(vals as string[])}
              fetchFn={fetchSystemRoles}
              formatHint={t("common.users.rolesHint")}
              renderBadge={(item, remove) => (
                <TranslatedBadge
                  kind="role"
                  token={typeof item === "string" ? item : item.name}
                  systemSlug={systemSlug ?? undefined}
                  onRemove={remove}
                />
              )}
            />
            <button
              onClick={handleEdit}
              disabled={actionLoading}
              className="w-full rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-4 py-3 font-semibold text-black transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {actionLoading && (
                <Spinner
                  size="sm"
                  className="border-black border-t-transparent"
                />
              )}
              {t("common.save")}
            </button>
          </div>
        </Modal>
      )}

      {/* Delete confirmation */}
      {deleteUser && (
        <Modal
          open={!!deleteUser}
          onClose={() => setDeleteUser(null)}
          title={t("common.users.deleteConfirm")}
        >
          <div className="text-center space-y-4">
            <p className="text-white">{t("common.users.deleteConfirm")}</p>
            <p className="text-sm text-[var(--color-light-text)]">
              {deleteUser.profileId?.name ?? primaryChannelLabel(deleteUser)}
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setDeleteUser(null)}
                className="rounded-lg border border-[var(--color-dark-gray)] px-4 py-2 text-[var(--color-light-text)] hover:bg-white/5 transition-colors"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleDelete}
                disabled={actionLoading}
                className="rounded-lg bg-red-500/80 px-4 py-2 text-white font-semibold hover:bg-red-500 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {actionLoading && <Spinner size="sm" />}
                {t("common.delete")}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
