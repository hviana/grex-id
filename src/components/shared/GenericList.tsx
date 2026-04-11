"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  CursorParams,
  FieldType,
  PaginatedResult,
} from "@/src/contracts/common";
import type { FilterConfig, FilterValues } from "./FilterDropdown.tsx";
import { useLocale } from "@/src/hooks/useLocale";
import SearchField from "./SearchField.tsx";
import CreateButton from "./CreateButton.tsx";
import EditButton from "./EditButton.tsx";
import DeleteButton from "./DeleteButton.tsx";
import FilterDropdown from "./FilterDropdown.tsx";
import FilterBadge from "./FilterBadge.tsx";
import GenericListItem from "./GenericListItem.tsx";
import Spinner from "./Spinner.tsx";
import FormModal from "./FormModal.tsx";

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
  debounceMs?: number;
  formSubforms?: SubformConfig[];
  createRoute?: string;
  editRoute?: (id: string) => string;
  deleteRoute?: (id: string) => string;
  fetchOneRoute?: (id: string) => string;
  authToken?: string | null;
  extraData?: Record<string, unknown>;
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
  debounceMs = 300,
  formSubforms = [],
  createRoute,
  editRoute,
  deleteRoute,
  fetchOneRoute,
  authToken,
  extraData,
}: GenericListProps<T>) {
  const { t } = useLocale();
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterValues, setFilterValues] = useState<FilterValues>({});
  const [cursor, setCursor] = useState<string | undefined>();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editItem, setEditItem] = useState<T | null>(null);
  const [editLoading, setEditLoading] = useState<string | null>(null);

  const load = useCallback(async (reset: boolean = false) => {
    setLoading(true);
    try {
      const result = await fetchFn({
        limit: 20,
        cursor: reset ? undefined : cursor,
        search: search || undefined,
        filters: Object.keys(filterValues).length > 0
          ? filterValues
          : undefined,
      });
      setItems(reset ? result.data : [...items, ...result.data]);
      setNextCursor(result.nextCursor);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, search, filterValues, fetchFn]);

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filterValues, fetchFn]);

  const handleSearch = useCallback((q: string) => {
    setSearch(q);
    setCursor(undefined);
  }, []);

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
    </>
  );

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
        {createEnabled && createRoute && (
          <CreateButton
            onClick={() => setShowCreateModal(true)}
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

      {nextCursor && (
        <div className="flex justify-center pt-4">
          <button
            onClick={() => {
              setCursor(nextCursor);
              load();
            }}
            disabled={loading}
            className="rounded-lg border border-[var(--color-dark-gray)] px-6 py-2 text-sm text-[var(--color-light-text)] hover:border-[var(--color-primary-green)] hover:text-white transition-colors flex items-center gap-2"
          >
            {loading ? <Spinner size="sm" /> : null}
            {t("common.loadMore")}
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
            load(true);
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
            load(true);
          }}
          onClose={() => setEditItem(null)}
        />
      )}
    </div>
  );
}
