"use client";

import { useContext } from "react";
import { LocaleContext } from "./LocaleProvider.tsx";
import type { LocaleContextValue } from "./LocaleProvider.tsx";

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error("useLocale must be used within a <LocaleProvider>");
  }
  return ctx;
}
