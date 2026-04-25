"use client";

import { useEffect } from "react";

/**
 * Updates document.title and the favicon dynamically based on the active
 * system. Pass null/undefined to revert to the static defaults ("Core" / favicon.ico).
 */
export function useBrandingHeader(
  name?: string | null,
  logoUrl?: string | null,
) {
  useEffect(() => {
    document.title = name ?? "Core";

    let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }

    if (logoUrl) {
      link.href = logoUrl;
      link.removeAttribute("type");
    } else {
      link.href = "/favicon.ico";
    }

    return () => {
      document.title = "Core";
      if (link) link.href = "/favicon.ico";
    };
  }, [name, logoUrl]);
}
