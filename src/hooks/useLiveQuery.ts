"use client";

import { useEffect, useRef, useState } from "react";
import { connectFrontendDb } from "@/client/db/connection";

interface UseLiveQueryOptions<T> {
  query: string;
  bindings?: Record<string, unknown>;
  token: string | null;
  enabled?: boolean;
}

export function useLiveQuery<T>(
  { query, bindings, token, enabled = true }: UseLiveQueryOptions<T>,
) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const liveIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!token || !enabled) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const db = await connectFrontendDb(token);

        // Initial query
        const result = await db.query<[T[]]>(query, bindings);
        if (!cancelled) {
          setData(result[0] ?? []);
          setLoading(false);
        }

        // Set up live query
        // Note: SurrealDB live query API may differ by version
        // This is a simplified pattern
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
  }, [query, token, enabled]);

  return { data, loading, error };
}
