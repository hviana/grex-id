"use client";

import { useEffect, useState, useCallback } from "react";

interface FrontCoreState {
  settings: Map<string, string>;
  loaded: boolean;
}

let cachedSettings: Map<string, string> | null = null;

export function useFrontCore() {
  const [state, setState] = useState<FrontCoreState>({
    settings: cachedSettings ?? new Map(),
    loaded: cachedSettings !== null,
  });

  const load = useCallback(async () => {
    if (cachedSettings) {
      setState({ settings: cachedSettings, loaded: true });
      return;
    }
    try {
      const res = await fetch("/api/public/front-core");
      const json = await res.json();
      if (json.success && json.data) {
        const map = new Map<string, string>();
        for (const [key, setting] of Object.entries(
          json.data as Record<string, { value: string }>,
        )) {
          map.set(key, setting.value);
        }
        cachedSettings = map;
        setState({ settings: map, loaded: true });
      }
    } catch {
      setState((s) => ({ ...s, loaded: true }));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const getSetting = useCallback(
    (key: string): string | undefined => {
      return state.settings.get(key);
    },
    [state.settings],
  );

  const reload = useCallback(async () => {
    cachedSettings = null;
    await load();
  }, [load]);

  return {
    settings: state.settings,
    loaded: state.loaded,
    getSetting,
    reload,
  };
}
