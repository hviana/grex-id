"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import GenericList from "@/src/components/shared/GenericList";
import Modal from "@/src/components/shared/Modal";
import Spinner from "@/src/components/shared/Spinner";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import EditButton from "@/src/components/shared/EditButton";
import DeleteButton from "@/src/components/shared/DeleteButton";
import UserSubform from "@/src/components/subforms/UserSubform";
import UserView, {
  userHasVerifiedChannel,
  type UserViewData,
} from "@/src/components/shared/UserView";
import AccessRequestModal from "@/src/components/shared/AccessRequestModal";
import RemoveAccessModal from "@/src/components/shared/RemoveAccessModal";
import type { SubformRef } from "@/src/contracts/high_level/components";
import type {
  CursorParams,
  PaginatedResult,
} from "@/src/contracts/high_level/pagination";
import { useTenantContext } from "@/src/hooks/useTenantContext";

export default function UsersPage() {
  const { t } = useTenantContext();
  const { systemToken } = useTenantContext();
  const { companyId, systemId, systemSlug, roles: myRoles } =
    useTenantContext();

  const isAdmin = myRoles.includes("admin") || myRoles.includes("superuser");

  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserViewData | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [shareUser, setShareUser] = useState<UserViewData | null>(null);
  const [removeAccessUser, setRemoveAccessUser] = useState<UserViewData | null>(
    null,
  );

  const createFormRef = useRef<SubformRef>(null);
  const editFormRef = useRef<SubformRef>(null);

  const [groupsMap, setGroupsMap] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!systemToken) return;
    let cancelled = false;
    const fetchGroups = async () => {
      try {
        const res = await fetch(
          `/api/groups?limit=200`,
          { headers: { Authorization: `Bearer ${systemToken}` } },
        );
        const json = await res.json();
        if (cancelled) return;
        const items = (json.items ?? json.data ?? []) as Record<
          string,
          unknown
        >[];
        const map = new Map<string, string>();
        for (const g of items) {
          map.set(String(g.id), String(g.name ?? ""));
        }
        setGroupsMap(map);
      } catch { /* groups feature is optional */ }
    };
    fetchGroups();
    return () => {
      cancelled = true;
    };
  }, [systemToken]);

  const fetchUsers = useCallback(
    async (
      params: CursorParams & { search?: string },
    ): Promise<PaginatedResult<UserViewData>> => {
      if (!systemToken || !companyId || !systemId) {
        return { items: [], total: 0, hasMore: false };
      }
      const p = new URLSearchParams({ limit: String(params.limit) });
      if (params.search) p.set("search", params.search);
      if (params.cursor) p.set("cursor", params.cursor);
      const res = await fetch(`/api/users?${p}`, {
        headers: { Authorization: `Bearer ${systemToken}` },
      });
      const json = await res.json();
      return {
        items: (json.items ?? []) as UserViewData[],
        total: json.total ?? 0,
        hasMore: json.hasMore ?? false,
        nextCursor: json.nextCursor,
      };
    },
    [systemToken, companyId, systemId],
  );

  const triggerReload = () => setReloadKey((k) => k + 1);

  const handleCreate = async () => {
    if (!systemToken || !companyId || !systemId) return;
    if (!createFormRef.current?.isValid()) {
      setError(t("common.error.validation"));
      return;
    }
    const data = createFormRef.current.getData();
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
          ...data,
          companyId,
          systemId,
          groupIds: data.groupIds,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        const msg = json.error?.errors?.map((e: string) => t(e)).join(", ") ??
          json.error?.message ?? "common.error.generic";
        setError(msg);
        return;
      }
      setCreateOpen(false);
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
    if (!editFormRef.current?.isValid()) {
      setError(t("common.error.validation"));
      return;
    }
    const data = editFormRef.current.getData();
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
          ...data,
          companyId,
          systemId,
          groupIds: data.groupIds,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        const msg = json.error?.errors?.map((e: string) => t(e)).join(", ") ??
          json.error?.message ?? "common.error.generic";
        setError(msg);
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

  const handleDelete = async (user: UserViewData) => {
    if (!systemToken) return;
    setError(null);
    const res = await fetch("/api/users", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${systemToken}`,
      },
      body: JSON.stringify({ userId: user.id }),
    });
    const json = await res.json();
    if (!json.success) {
      const msg = json.error?.errors?.map((e: string) => t(e)).join(", ") ??
        json.error?.message ?? "common.error.generic";
      setError(msg);
      throw new Error(msg);
    }
    triggerReload();
  };

  const handleResendInvitation = async (userId: string) => {
    if (!systemToken) return;
    setResendingId(userId);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/users?action=resend-invitation`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({ userId, companyId, systemId }),
      });
      const json = await res.json();
      if (json.success) {
        setSuccessMsg("common.users.invitationSent");
      } else {
        setError(json.error?.message ?? "common.error.generic");
      }
    } catch {
      setError("common.error.network");
    } finally {
      setResendingId(null);
    }
  };

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

      <GenericList<UserViewData>
        entityName={t("common.menu.users")}
        searchEnabled={false}
        createEnabled={false}
        controlButtons={[]}
        fetchFn={fetchUsers}
        reloadKey={reloadKey}
        renderItem={(user) => (
          <UserView
            user={user}
            systemSlug={systemSlug ?? undefined}
            groupNames={Array.isArray(user.groupIds)
              ? (user.groupIds as string[]).map((id) =>
                groupsMap.get(String(id))
              ).filter((n): n is string => !!n)
              : undefined}
            controls={isAdmin
              ? (
                <>
                  {!userHasVerifiedChannel(user) && (
                    <button
                      onClick={() => handleResendInvitation(user.id)}
                      disabled={resendingId === user.id}
                      title={t("common.users.resendInvitation")}
                      className="text-sm px-2 py-1 rounded border border-[var(--color-secondary-blue)]/30 text-[var(--color-secondary-blue)] hover:bg-[var(--color-secondary-blue)]/10 transition-colors disabled:opacity-50"
                    >
                      {resendingId === user.id ? <Spinner size="sm" /> : "📨"}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setShareUser(user);
                      setError(null);
                      setSuccessMsg(null);
                    }}
                    title={t("access.share")}
                    className="text-sm px-2 py-1 rounded border border-[var(--color-primary-green)]/30 text-[var(--color-primary-green)] hover:bg-[var(--color-primary-green)]/10 transition-colors"
                  >
                    🔗
                  </button>
                  <button
                    onClick={() => {
                      setRemoveAccessUser(user);
                      setError(null);
                      setSuccessMsg(null);
                    }}
                    title={t("access.removeTitle")}
                    className="text-sm px-2 py-1 rounded border border-[var(--color-secondary-blue)]/30 text-[var(--color-secondary-blue)] hover:bg-[var(--color-secondary-blue)]/10 transition-colors"
                  >
                    🔓
                  </button>
                  <EditButton
                    onClick={() => {
                      setEditUser(user);
                      setError(null);
                    }}
                  />
                  <DeleteButton onConfirm={() => handleDelete(user)} />
                </>
              )
              : undefined}
          />
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
            <UserSubform
              ref={createFormRef}
              isCreate
              systemSlug={systemSlug ?? undefined}
            />
            <p className="text-xs text-[var(--color-light-text)]/60">
              {t("common.users.inviteHint")}
            </p>
            <button
              onClick={handleCreate}
              disabled={actionLoading}
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
            <UserSubform
              ref={editFormRef}
              initialData={{
                name: editUser.profileId?.name ?? "",
                contextRoles: editUser.contextRoles ?? [],
                groupIds: Array.isArray(editUser.groupIds)
                  ? (editUser.groupIds as string[]).map((id) => ({
                    id: String(id),
                    name: groupsMap.get(String(id)) ?? String(id),
                  }))
                  : undefined,
              }}
              systemSlug={systemSlug ?? undefined}
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

      {/* Share access modal */}
      {shareUser && (
        <AccessRequestModal
          entityType="user"
          entityId={shareUser.id}
          entityLabel={shareUser.profileId?.name ?? String(shareUser.id)}
          onSuccess={() => {
            setShareUser(null);
            setSuccessMsg("access.requestSent");
            triggerReload();
          }}
          onClose={() => setShareUser(null)}
        />
      )}

      {/* Remove access modal */}
      {removeAccessUser && (
        <RemoveAccessModal
          entityType="user"
          entityId={removeAccessUser.id}
          entityLabel={removeAccessUser.profileId?.name ??
            String(removeAccessUser.id)}
          showPermission={false}
          onSuccess={() => {
            setRemoveAccessUser(null);
            setSuccessMsg("access.removed");
            triggerReload();
          }}
          onClose={() => setRemoveAccessUser(null)}
        />
      )}
    </div>
  );
}
