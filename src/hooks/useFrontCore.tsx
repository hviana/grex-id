"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

interface FrontCoreState {
  settings: Map<string, string>;
  loaded: boolean;
}

interface FrontCoreContextValue extends FrontCoreState {
  getSetting: (key: string) => string | undefined;
  reload: () => Promise<void>;
}

const FrontCoreContext = createContext<FrontCoreContextValue | null>(null);

export function FrontCoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<FrontCoreState>({
    settings: new Map(),
    loaded: false,
  });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/public/front-core");
      const json = await res.json();
      if (json.success && json.data) {
        const map = new Map<string, string>();
        for (
          const [key, setting] of Object.entries(
            json.data as Record<string, { value: string }>,
          )
        ) {
          map.set(key, setting.value);
        }
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
    await load();
  }, [load]);

  const value = useMemo<FrontCoreContextValue>(
    () => ({
      settings: state.settings,
      loaded: state.loaded,
      getSetting,
      reload,
    }),
    [state, getSetting, reload],
  );

  return (
    <FrontCoreContext.Provider value={value}>
      {children}
    </FrontCoreContext.Provider>
  );
}

export function useFrontCore(): FrontCoreContextValue {
  const ctx = useContext(FrontCoreContext);
  if (!ctx) {
    throw new Error("useFrontCore must be used within a FrontCoreProvider");
  }
  return ctx;
}
