"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/src/hooks/useLocale";
import { useAuth } from "@/src/hooks/useAuth";
import { useSystemContext } from "@/src/hooks/useSystemContext";
import Spinner from "@/src/components/shared/Spinner";
import SearchField from "@/src/components/shared/SearchField";
import Modal from "@/src/components/shared/Modal";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import MultiBadgeField from "@/src/components/fields/MultiBadgeField";
import TranslatedBadge from "@/src/components/shared/TranslatedBadge";

interface ChannelRow {
  id: string;
  type: string;
  value: string;
  verified: boolean;
}

interface UserItem {
  id: string;
  profile?: {
    name: string;
    avatarUri?: string;
    channels?: ChannelRow[];
  };
  roles: string[];
  contextRoles?: string[];
  createdAt: string;
}

function channelOf(user: UserItem, type: string): ChannelRow | undefined {
  const list = user.profile?.channels ?? [];
  return list.find((c) => c.type === type);
}

function primaryEmail(user: UserItem): string {
  return channelOf(user, "email")?.value ?? "";
}

function primaryPhone(user: UserItem): string {
  return channelOf(user, "phone")?.value ?? "";
}

export default function UsersPage() {
  const { t } = useLocale();
  const { systemToken } = useAuth();
  const { companyId, systemId, systemSlug, roles: myRoles } =
    useSystemContext();

  const isAdmin = myRoles.includes("admin") || myRoles.includes("superuser");

  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserItem | null>(null);
  const [deleteUser, setDeleteUser] = useState<UserItem | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Create form state
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRoles, setNewRoles] = useState<string[]>([]);

  // Edit form state
  const [editName, setEditName] = useState("");
  const [editRoles, setEditRoles] = useState<string[]>([]);

  // Fetch available role names for this system
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

  const loadUsers = useCallback(
    async (searchQuery?: string) => {
      if (!systemToken || !companyId || !systemId) return;
      setLoading(true);
      try {
        const params = new URLSearchParams({
          limit: "20",
          companyId,
          systemId,
        });
        if (searchQuery) params.set("search", searchQuery);
        const res = await fetch(`/api/users?${params}`, {
          headers: { Authorization: `Bearer ${systemToken}` },
        });
        const json = await res.json();
        if (json.success) setUsers(json.data ?? []);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    },
    [systemToken, companyId, systemId],
  );

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleSearch = useCallback(
    (value: string) => {
      loadUsers(value);
    },
    [loadUsers],
  );

  const handleCreate = async () => {
    if (!systemToken || !companyId || !systemId) return;
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
          channels: [
            ...(newEmail ? [{ type: "email", value: newEmail }] : []),
            ...(newPhone ? [{ type: "phone", value: newPhone }] : []),
          ],
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
      setNewEmail("");
      setNewPhone("");
      setNewName("");
      setNewPassword("");
      setNewRoles([]);
      if (json.invited) {
        setSuccessMsg("common.users.inviteExisting");
      }
      await loadUsers();
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
      await loadUsers();
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
      await loadUsers();
    } catch {
      setError("common.error.network");
    } finally {
      setActionLoading(false);
    }
  };

  const openEdit = (user: UserItem) => {
    setEditUser(user);
    setEditName(user.profile?.name ?? "");
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

      <SearchField
        onSearch={handleSearch}
        placeholder={t("common.placeholder.search")}
      />

      {successMsg && (
        <div className="rounded-lg bg-[var(--color-primary-green)]/10 border border-[var(--color-primary-green)]/30 p-3 text-sm text-[var(--color-primary-green)]">
          {t(successMsg)}
        </div>
      )}

      <ErrorDisplay message={error} />

      {loading
        ? (
          <div className="flex justify-center py-8">
            <Spinner size="lg" />
          </div>
        )
        : users.length === 0
        ? (
          <div className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-8 text-center">
            <div className="text-4xl mb-3">👥</div>
            <p className="text-[var(--color-light-text)]">
              {t("common.empty")}
            </p>
          </div>
        )
        : (
          <div className="space-y-3">
            {users.map((user) => (
              <div
                key={user.id}
                className="backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-xl p-4 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 transition-all duration-200"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] flex items-center justify-center text-black font-bold text-sm shrink-0">
                    {(user.profile?.name ?? primaryEmail(user))
                      .charAt(0)
                      .toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-white truncate">
                      {user.profile?.name ?? primaryEmail(user)}
                    </h3>
                    <p className="text-sm text-[var(--color-light-text)] truncate">
                      {primaryEmail(user)}
                    </p>
                  </div>
                  <div className="flex gap-1.5 flex-wrap shrink-0">
                    {(user.contextRoles ?? user.roles).map((role) => (
                      <TranslatedBadge
                        key={role}
                        kind="role"
                        token={role}
                        systemSlug={systemSlug ?? undefined}
                      />
                    ))}
                  </div>
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
            ))}
          </div>
        )}

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
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder={t("common.placeholder.email")}
              className={inputCls}
            />
            <input
              type="tel"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              placeholder={t("common.placeholder.phone")}
              className={inputCls}
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
              disabled={actionLoading || !newEmail || !newName}
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
                {t("common.users.email")}
              </label>
              <p className="text-white text-sm">{primaryEmail(editUser)}</p>
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
              {deleteUser.profile?.name ?? primaryEmail(deleteUser)}
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
