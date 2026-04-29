"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Spinner from "@/src/components/shared/Spinner";
import Modal from "@/src/components/shared/Modal";
import DeleteButton from "@/src/components/shared/DeleteButton";
import ErrorDisplay from "@/src/components/shared/ErrorDisplay";
import MultiBadgeField from "@/src/components/fields/MultiBadgeField";
import type { BadgeValue } from "@/src/contracts/high-level/components";
import TranslatedBadge from "@/src/components/shared/TranslatedBadge";
import { useTenantContext } from "@/src/hooks/useTenantContext";
import type {
  MenuItemView,
  MenuTreeEditorProps,
  TreeNode,
} from "@/src/contracts/high-level/menu-item";

function buildTree(items: MenuItemView[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const item of items) {
    map.set(item.id, { ...item, children: [] });
  }

  for (const item of items) {
    const node = map.get(item.id)!;
    if (item.parentId && map.has(String(item.parentId))) {
      map.get(String(item.parentId))!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder);
    for (const n of nodes) sort(n.children);
  };
  sort(roots);
  return roots;
}

function isIncomplete(node: TreeNode): boolean {
  if (node.children.length > 0 && !node.componentName) return false;
  if (node.children.length === 0 && !node.componentName) return true;
  return false;
}

export default function MenuTreeEditor(
  { systemId, systemSlug }: MenuTreeEditorProps,
) {
  const { t } = useTenantContext();
  const { systemToken } = useTenantContext();
  const [items, setItems] = useState<MenuItemView[]>([]);
  const [loading, setLoading] = useState(true);
  const [editItem, setEditItem] = useState<MenuItemView | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Inline add state
  const [addingAt, setAddingAt] = useState<string | null>(null);
  const [addLabel, setAddLabel] = useState("");
  const [addSaving, setAddSaving] = useState(false);
  const addInputRef = useRef<HTMLInputElement>(null);

  // Edit form state
  const [formName, setFormName] = useState("");
  const [formEmoji, setFormEmoji] = useState("");
  const [formComponentName, setFormComponentName] = useState("");
  const [formSortOrder, setFormSortOrder] = useState("0");
  const [formRoleIds, setFormRoleIds] = useState<BadgeValue[]>([]);
  const [formHiddenInPlanIds, setFormHiddenInPlanIds] = useState<BadgeValue[]>(
    [],
  );

  // Drag state
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const fetchRoles = useCallback(
    async (search: string): Promise<BadgeValue[]> => {
      const res = await fetch(
        `/api/core/roles?systemId=${encodeURIComponent(systemId)}&search=${
          encodeURIComponent(search)
        }&limit=20`,
        { headers: { Authorization: `Bearer ${systemToken}` } },
      );
      const json = await res.json();
      return (json.data ?? []).map(
        (r: { id: string; name: string }) => ({
          id: String(r.id),
          name: r.name,
        }),
      );
    },
    [systemId, systemToken],
  );

  const fetchPlans = useCallback(
    async (search: string): Promise<BadgeValue[]> => {
      const res = await fetch(
        `/api/core/plans?systemId=${encodeURIComponent(systemId)}&search=${
          encodeURIComponent(search)
        }&limit=20`,
        { headers: { Authorization: `Bearer ${systemToken}` } },
      );
      const json = await res.json();
      return (json.items ?? []).map((p: { id: string; name: string }) => ({
        id: String(p.id),
        name: p.name,
      }));
    },
    [systemId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/core/menus?systemId=${systemId}&limit=200`,
        { headers: { Authorization: `Bearer ${systemToken}` } },
      );
      const json = await res.json();
      if (json.success) setItems(json.items ?? []);
    } finally {
      setLoading(false);
    }
  }, [systemId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (addingAt && addInputRef.current) {
      addInputRef.current.focus();
    }
  }, [addingAt]);

  const handleInlineAdd = async (parentId: string | null) => {
    if (!addLabel.trim()) return;
    setAddSaving(true);
    try {
      const siblings = items.filter(
        (m) => String(m.parentId ?? "") === String(parentId ?? ""),
      );
      const maxSort = siblings.reduce(
        (max, m) => Math.max(max, m.sortOrder),
        -1,
      );

      const res = await fetch("/api/core/menus", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({
          systemId,
          parentId: parentId || null,
          name: addLabel.trim(),
          sortOrder: maxSort + 1,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setAddLabel("");
        setAddingAt(null);
        load();
      }
    } finally {
      setAddSaving(false);
    }
  };

  const openEdit = async (item: MenuItemView) => {
    setFormName(item.name);
    setFormEmoji(item.emoji ?? "");
    setFormComponentName(item.componentName ?? "");
    setFormSortOrder(String(item.sortOrder));
    setError(null);
    setValidationErrors([]);

    // Resolve role IDs to { id, name } objects
    const roleIdList = Array.isArray(item.roleIds)
      ? item.roleIds.map(String)
      : [];
    if (roleIdList.length > 0) {
      try {
        const res = await fetch(
          `/api/core/roles?systemId=${encodeURIComponent(systemId)}&limit=200`,
          { headers: { Authorization: `Bearer ${systemToken}` } },
        );
        const json = await res.json();
        const roleMap = new Map<string, string>();
        for (const r of json.data ?? []) {
          roleMap.set(String(r.id), r.name);
        }
        setFormRoleIds(
          roleIdList.map((id) => ({ id, name: roleMap.get(id) ?? id })),
        );
      } catch {
        setFormRoleIds(roleIdList.map((id) => ({ id, name: id })));
      }
    } else {
      setFormRoleIds([]);
    }

    // Resolve plan IDs to { id, name } objects
    const planIds = Array.isArray(item.hiddenInPlanIds)
      ? item.hiddenInPlanIds.map(String)
      : [];
    if (planIds.length > 0) {
      try {
        const res = await fetch(
          `/api/core/plans?systemId=${encodeURIComponent(systemId)}&limit=200`,
          { headers: { Authorization: `Bearer ${systemToken}` } },
        );
        const json = await res.json();
        const planMap = new Map<string, string>();
        for (const p of json.data ?? []) {
          planMap.set(String(p.id), p.name);
        }
        setFormHiddenInPlanIds(
          planIds.map((id) => ({ id, name: planMap.get(id) ?? id })),
        );
      } catch {
        setFormHiddenInPlanIds(planIds.map((id) => ({ id, name: id })));
      }
    } else {
      setFormHiddenInPlanIds([]);
    }

    setEditItem(item);
  };

  const handleEditSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editItem) return;
    setSaving(true);
    setError(null);
    setValidationErrors([]);
    try {
      const res = await fetch("/api/core/menus", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${systemToken}`,
        },
        body: JSON.stringify({
          id: editItem.id,
          name: formName,
          emoji: formEmoji || null,
          componentName: formComponentName,
          sortOrder: Number(formSortOrder),
          roleIds: formRoleIds.map((r) =>
            typeof r === "string" ? r : r.id ?? r.name
          ),
          hiddenInPlanIds: formHiddenInPlanIds.map((p) =>
            typeof p === "string" ? p : p.id ?? p.name
          ),
        }),
      });
      const json = await res.json();
      if (!json.success) {
        if (json.error?.errors) {
          setValidationErrors(json.error.errors);
        } else {
          setError(json.error?.message ?? "common.error.generic");
        }
        return;
      }
      setEditItem(null);
      load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await fetch("/api/core/menus", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${systemToken}`,
      },
      body: JSON.stringify({ id }),
    });
    load();
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDrop = async (
    e: React.DragEvent,
    targetId: string,
    position: "before" | "inside",
  ) => {
    e.preventDefault();
    setDropTarget(null);
    if (!dragId || dragId === targetId) return;

    const draggedItem = items.find((i) => i.id === dragId);
    const targetItem = items.find((i) => i.id === targetId);
    if (!draggedItem || !targetItem) return;

    let newParentId: string | null;
    let newSortOrder: number;

    if (position === "inside") {
      newParentId = targetId;
      const children = items.filter((m) => String(m.parentId) === targetId);
      newSortOrder = children.reduce(
        (max, m) => Math.max(max, m.sortOrder),
        -1,
      ) + 1;
    } else {
      newParentId = targetItem.parentId ? String(targetItem.parentId) : null;
      newSortOrder = targetItem.sortOrder;
    }

    setItems((prev) =>
      prev.map((item) =>
        item.id === dragId
          ? { ...item, parentId: newParentId, sortOrder: newSortOrder }
          : item
      )
    );

    await fetch("/api/core/menus", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${systemToken}`,
      },
      body: JSON.stringify({
        id: dragId,
        parentId: newParentId,
        sortOrder: newSortOrder,
      }),
    });

    setDragId(null);
    load();
  };

  const handleDragOver = (e: React.DragEvent, nodeId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget(nodeId);
  };

  const handleDragEnd = () => {
    setDragId(null);
    setDropTarget(null);
  };

  const inputCls =
    "w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white outline-none focus:border-[var(--color-primary-green)] transition-colors placeholder-white/30";

  const renderInlineAdd = (parentId: string | null, isRoot: boolean) => {
    const key = parentId ?? "root";
    if (addingAt !== key) {
      return (
        <button
          type="button"
          onClick={() => {
            setAddingAt(key);
            setAddLabel("");
          }}
          className={`group flex items-center gap-2 rounded-lg border border-dashed border-[var(--color-dark-gray)]/40 px-3 py-2 text-sm text-[var(--color-light-text)] hover:border-[var(--color-primary-green)]/50 hover:text-[var(--color-primary-green)] transition-all ${
            isRoot ? "w-full" : "ml-1 mt-1"
          }`}
        >
          <span className="text-base leading-none group-hover:scale-110 transition-transform">
            +
          </span>
          <span>
            {isRoot ? t("core.menus.addRoot") : t("core.menus.addChild")}
          </span>
        </button>
      );
    }

    return (
      <div className={`flex items-center gap-2 ${isRoot ? "" : "ml-1 mt-1"}`}>
        <input
          ref={addInputRef}
          type="text"
          value={addLabel}
          onChange={(e) =>
            setAddLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleInlineAdd(parentId);
            }
            if (e.key === "Escape") {
              setAddingAt(null);
              setAddLabel("");
            }
          }}
          placeholder={t("core.menus.enterName")}
          className="flex-1 rounded-lg border border-[var(--color-primary-green)]/50 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[var(--color-primary-green)] transition-colors placeholder-white/30"
        />
        {addSaving ? <Spinner size="sm" /> : (
          <>
            <button
              type="button"
              onClick={() => handleInlineAdd(parentId)}
              disabled={!addLabel.trim()}
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--color-primary-green)]/20 text-[var(--color-primary-green)] hover:bg-[var(--color-primary-green)]/30 transition-colors disabled:opacity-30"
            >
              ✓
            </button>
            <button
              type="button"
              onClick={() => {
                setAddingAt(null);
                setAddLabel("");
              }}
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
            >
              ✕
            </button>
          </>
        )}
      </div>
    );
  };

  const renderTree = (nodes: TreeNode[], depth: number = 0) => (
    <div
      className={depth > 0
        ? "ml-5 pl-4 border-l-2 border-[var(--color-dark-gray)]/30"
        : ""}
    >
      {nodes.map((node) => {
        const isDragging = dragId === node.id;
        const isDropping = dropTarget === node.id && dragId !== node.id;

        return (
          <div key={node.id} className="mt-1.5 first:mt-0">
            <div
              draggable
              onDragStart={(e) => handleDragStart(e, node.id)}
              onDragOver={(e) => handleDragOver(e, node.id)}
              onDragLeave={() => setDropTarget(null)}
              onDragEnd={handleDragEnd}
              onDrop={(e) =>
                handleDrop(
                  e,
                  node.id,
                  node.children.length > 0 ? "inside" : "before",
                )}
              className={`
                group flex items-center gap-3 rounded-xl px-4 py-2.5
                backdrop-blur-md border transition-all duration-200
                cursor-grab active:cursor-grabbing
                ${
                isDragging
                  ? "opacity-40 scale-95"
                  : isDropping
                  ? "border-[var(--color-primary-green)] bg-[var(--color-primary-green)]/10 shadow-md shadow-[var(--color-primary-green)]/10"
                  : "border-[var(--color-dark-gray)]/60 bg-white/[0.03] hover:bg-white/[0.06] hover:border-[var(--color-dark-gray)]"
              }
              `}
            >
              {/* Drag handle */}
              <span className="text-[var(--color-dark-gray)] group-hover:text-[var(--color-light-text)] transition-colors text-xs select-none cursor-grab">
                ⠿
              </span>

              {/* Emoji + Label */}
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="text-lg leading-none shrink-0">
                  {node.emoji ?? (node.children.length > 0 ? "📁" : "📄")}
                </span>
                <span className="font-medium text-sm text-white truncate">
                  {t(node.name)}
                </span>
                {node.componentName && (
                  <span className="hidden sm:inline text-xs text-[var(--color-light-text)]/40 font-mono truncate">
                    {node.componentName}
                  </span>
                )}
                {isIncomplete(node) && (
                  <span
                    className="text-sm text-yellow-400 shrink-0"
                    title={t("core.menus.incompleteConfig")}
                  >
                    ⚠
                  </span>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openEdit(node);
                  }}
                  className="flex items-center justify-center w-7 h-7 rounded-lg text-[var(--color-light-text)] hover:bg-white/10 hover:text-white transition-all text-sm"
                  title={t("core.menus.edit")}
                >
                  ✏️
                </button>
                <DeleteButton
                  onConfirm={() => handleDelete(node.id)}
                />
              </div>
            </div>

            {/* Children */}
            {node.children.length > 0 && renderTree(node.children, depth + 1)}

            {/* Inline add child */}
            {renderInlineAdd(node.id, false)}
          </div>
        );
      })}
    </div>
  );

  const tree = buildTree(items);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.length === 0
        ? (
          <p className="text-center py-8 text-[var(--color-light-text)]">
            {t("core.menus.empty")}
          </p>
        )
        : renderTree(tree)}

      {/* Root-level add button */}
      <div className="mt-3">{renderInlineAdd(null, true)}</div>

      {/* Edit Modal */}
      <Modal
        open={!!editItem}
        onClose={() => setEditItem(null)}
        title={t("core.menus.edit")}
      >
        <ErrorDisplay message={error} errors={validationErrors} />
        <form onSubmit={handleEditSave} className="mt-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
                {t("core.menus.name")} *
              </label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                required
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
                {t("core.menus.emoji")}
              </label>
              <input
                type="text"
                value={formEmoji}
                onChange={(e) => setFormEmoji(e.target.value)}
                placeholder={t("core.menus.placeholder.emoji")}
                className={inputCls}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
                {t("core.menus.componentName")}
              </label>
              <input
                type="text"
                value={formComponentName}
                onChange={(e) => setFormComponentName(e.target.value)}
                placeholder={t("core.menus.placeholder.componentName")}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
                {t("core.menus.sortOrder")}
              </label>
              <input
                type="number"
                value={formSortOrder}
                onChange={(e) => setFormSortOrder(e.target.value)}
                min="0"
                className={inputCls}
              />
            </div>
          </div>

          <MultiBadgeField
            name={t("core.menus.roleIds")}
            mode="search"
            value={formRoleIds}
            onChange={(vals) => setFormRoleIds(vals)}
            fetchFn={fetchRoles}
            renderBadge={(item, remove) => (
              <TranslatedBadge
                kind="role"
                token={typeof item === "string"
                  ? item
                  : item.name ?? String(item)}
                systemSlug={systemSlug}
                onRemove={remove}
              />
            )}
          />

          <MultiBadgeField
            name={t("core.menus.hiddenInPlanIds")}
            mode="search"
            value={formHiddenInPlanIds}
            onChange={(vals) => setFormHiddenInPlanIds(vals)}
            fetchFn={fetchPlans}
          />

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-lg bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] px-4 py-3 font-semibold text-black transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving
              ? (
                <Spinner
                  size="sm"
                  className="border-black border-t-transparent"
                />
              )
              : null}
            {t("common.save")}
          </button>
        </form>
      </Modal>
    </div>
  );
}
