"use client";

import { useEffect, useMemo, useState } from "react";
import { connectFrontendDb } from "@/src/lib/db/connection";
import type { UseLiveQueryOptions } from "@/src/contracts/high-level/component-props";

export function useLiveQuery<T>(
  { query, bindings, enabled = true }: UseLiveQueryOptions<T>,
) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const stableBindings = useMemo(
    () => bindings,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(bindings)],
  );

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const db = await connectFrontendDb();

        const result = await db.query<[T[]]>(query, stableBindings);
        if (!cancelled) {
          setData(result[0] ?? []);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [query, stableBindings, enabled]);

  return { data, loading, error };
}
