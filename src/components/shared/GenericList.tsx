"use client";

import { useCallback, useEffect, useState } from "react";
import type { FieldType } from "@/src/contracts/common";
import type {
  CursorParams,
  PaginatedResult,
} from "@/src/contracts/high_level/pagination";
import type { FilterConfig, FilterValues } from "./FilterDropdown.tsx";
import SearchField from "./SearchField.tsx";
import CreateButton from "./CreateButton.tsx";
import EditButton from "./EditButton.tsx";
import DeleteButton from "./DeleteButton.tsx";
import FilterDropdown from "./FilterDropdown.tsx";
import FilterBadge from "./FilterBadge.tsx";
import GenericListItem from "./GenericListItem.tsx";
import Spinner from "./Spinner.tsx";
import FormModal from "./FormModal.tsx";
import { useTenantContext } from "@/src/hooks/useTenantContext";

export interface SubformConfig {
  component: React.ComponentType<{
    ref: React.Ref<SubformRef>;
    initialData?: Record<string, unknown>;
    [key: string]: unknown;
  }>;
  key: string;
  extraProps?: Record<string, unknown>;
}

export interface SubformRef {
  getData(): Record<string, unknown>;
  isValid(): boolean;
}

interface GenericListProps<T extends Record<string, unknown>> {
  entityName: string;
  searchEnabled?: boolean;
  createEnabled?: boolean;
  filters?: FilterConfig[];
  fetchFn: (
    params: CursorParams & { search?: string; filters?: FilterValues },
  ) => Promise<PaginatedResult<T>>;
  renderItem?: (item: T, controls: React.ReactNode) => React.ReactNode;
  fieldMap?: Record<string, FieldType>;
  controlButtons?: ("edit" | "delete")[];
  actionComponents?: {
    key: string;
    component: React.ComponentType<{ item: T }>;
  }[];
  debounceMs?: number;
  formSubforms?: SubformConfig[];
  createRoute?: string;
  editRoute?: (id: string) => string;
  deleteRoute?: (id: string) => string;
  fetchOneRoute?: (id: string) => string;
  authToken?: string | null;
  extraData?: Record<string, unknown>;
  onCreateClick?: () => void;
  reloadKey?: number | string;
}

export default function GenericList<T extends Record<string, unknown>>({
  entityName,
  searchEnabled = true,
  createEnabled = true,
  filters = [],
  fetchFn,
  renderItem,
  fieldMap,
  controlButtons = ["edit", "delete"],
  actionComponents = [],
  debounceMs = 300,
  formSubforms = [],
  createRoute,
  editRoute,
  deleteRoute,
  fetchOneRoute,
  authToken,
  extraData,
  onCreateClick,
  reloadKey,
}: GenericListProps<T>) {
  const { t } = useTenantContext();
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterValues, setFilterValues] = useState<FilterValues>({});
  const [hasMore, setHasMore] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editItem, setEditItem] = useState<T | null>(null);
  const [editLoading, setEditLoading] = useState<string | null>(null);

  // Stack-based pagination: stack[0] = undefined (first page), push cursors as you advance
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([
    undefined,
  ]);
  const currentCursor = cursorStack[cursorStack.length - 1];
  const pageIndex = cursorStack.length; // 1-based

  const loadPage = useCallback(
    async (cursor: string | undefined) => {
      setLoading(true);
      try {
        const result = await fetchFn({
          limit: 20,
          cursor,
          search: search || undefined,
          filters: Object.keys(filterValues).length > 0
            ? filterValues
            : undefined,
        });
        setItems(result.items);
        setTotal(result.total);
        setHasMore(result.hasMore);
      } finally {
        setLoading(false);
      }
    },
    [search, filterValues, fetchFn],
  );

  // Initial load and reload on search/filter/reloadKey changes
  useEffect(() => {
    setCursorStack([undefined]);
    loadPage(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filterValues, fetchFn, reloadKey]);

  const handleSearch = useCallback((q: string) => {
    setSearch(q);
  }, []);

  const goNext = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchFn({
        limit: 20,
        cursor: currentCursor,
        search: search || undefined,
        filters: Object.keys(filterValues).length > 0
          ? filterValues
          : undefined,
      });
      setItems(result.items);
      setTotal(result.total);
      setHasMore(result.hasMore);
      if (result.nextCursor) {
        setCursorStack((prev) => [...prev, result.nextCursor!]);
      }
    } finally {
      setLoading(false);
    }
  }, [currentCursor, search, filterValues, fetchFn]);

  const goPrev = useCallback(() => {
    if (cursorStack.length <= 1) return;
    const newStack = cursorStack.slice(0, -1);
    setCursorStack(newStack);
    loadPage(newStack[newStack.length - 1]);
  }, [cursorStack, loadPage]);

  const authHeaders: HeadersInit = authToken
    ? { Authorization: `Bearer ${authToken}` }
    : {};

  const handleDelete = async (id: string) => {
    if (!deleteRoute) return;
    await fetch(deleteRoute(id), { method: "DELETE", headers: authHeaders });
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const handleEdit = async (item: T) => {
    if (fetchOneRoute) {
      setEditLoading(item.id as string);
      try {
        const res = await fetch(fetchOneRoute(item.id as string), {
          headers: authHeaders,
        });
        const json = await res.json();
        if (json.success) {
          setEditItem(json.data);
          return;
        }
      } finally {
        setEditLoading(null);
      }
    }
    setEditItem(item);
  };

  const renderControls = (item: T) => (
    <>
      {controlButtons.includes("edit") && editRoute && (
        <EditButton
          onClick={() => handleEdit(item)}
          loading={editLoading === (item.id as string)}
        />
      )}
      {controlButtons.includes("delete") && deleteRoute && (
        <DeleteButton onConfirm={() => handleDelete(item.id as string)} />
      )}
      {actionComponents.map(({ key, component: ActionComp }) => (
        <ActionComp key={key} item={item} />
      ))}
    </>
  );

  const isFirstPage = cursorStack.length <= 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {searchEnabled && (
          <div className="flex-1 min-w-48">
            <SearchField onSearch={handleSearch} debounceMs={debounceMs} />
          </div>
        )}
        {filters.length > 0 && (
          <FilterDropdown
            filters={filters}
            values={filterValues}
            onChange={setFilterValues}
          />
        )}
        {createEnabled && (createRoute || onCreateClick) && (
          <CreateButton
            onClick={onCreateClick ?? (() => setShowCreateModal(true))}
            label={entityName}
          />
        )}
      </div>

      {Object.entries(filterValues).filter(([, v]) => v).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(filterValues)
            .filter(([, v]) => v)
            .map(([key, value]) => (
              <FilterBadge
                key={key}
                label={`${key}: ${value}`}
                onRemove={() => {
                  const next = { ...filterValues };
                  delete next[key];
                  setFilterValues(next);
                }}
              />
            ))}
        </div>
      )}

      {loading && items.length === 0
        ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        )
        : items.length === 0
        ? (
          <div className="text-center py-12 text-[var(--color-light-text)]">
            {t("common.noResults")}
          </div>
        )
        : (
          <div className="space-y-3">
            {items.map((item, idx) =>
              renderItem
                ? (
                  <div key={(item.id as string) ?? idx}>
                    {renderItem(item, renderControls(item))}
                  </div>
                )
                : fieldMap
                ? (
                  <GenericListItem
                    key={(item.id as string) ?? idx}
                    data={item}
                    fieldMap={fieldMap}
                    controls={renderControls(item)}
                  />
                )
                : null
            )}
          </div>
        )}

      {total > 0 && (
        <div className="flex items-center justify-center gap-4 pt-4">
          <button
            onClick={goPrev}
            disabled={isFirstPage || loading}
            className="rounded-lg border border-[var(--color-dark-gray)] px-4 py-2 text-sm text-[var(--color-light-text)] hover:border-[var(--color-primary-green)] hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {t("common.previous")}
          </button>

          <span className="text-sm text-[var(--color-light-text)]">
            {t("common.page")} {pageIndex}
          </span>

          <button
            onClick={goNext}
            disabled={!hasMore || loading}
            className="rounded-lg border border-[var(--color-dark-gray)] px-4 py-2 text-sm text-[var(--color-light-text)] hover:border-[var(--color-primary-green)] hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {loading ? <Spinner size="sm" /> : null}
            {t("common.next")}
          </button>
        </div>
      )}

      {showCreateModal && createRoute && formSubforms.length > 0 && (
        <FormModal
          title={entityName}
          subforms={formSubforms}
          submitRoute={createRoute}
          method="POST"
          authToken={authToken}
          extraData={extraData}
          onSuccess={() => {
            setShowCreateModal(false);
            loadPage(undefined);
          }}
          onClose={() => setShowCreateModal(false)}
        />
      )}

      {editItem && editRoute && formSubforms.length > 0 && (
        <FormModal
          title={entityName}
          subforms={formSubforms}
          submitRoute={editRoute(editItem.id as string)}
          method="PUT"
          initialData={editItem}
          authToken={authToken}
          extraData={extraData}
          onSuccess={() => {
            setEditItem(null);
            loadPage(undefined);
          }}
          onClose={() => setEditItem(null)}
        />
      )}
    </div>
  );
}
