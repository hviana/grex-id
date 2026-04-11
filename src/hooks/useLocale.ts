"use client";

import { useContext } from "react";
import { LocaleContext } from "./LocaleProvider";
import type { LocaleContextValue } from "./LocaleProvider";

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error("useLocale must be used within a <LocaleProvider>");
  }
  return ctx;
}
