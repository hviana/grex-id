"use client";

import Spinner from "@/src/components/shared/Spinner";

/**
 * Lightweight entry point for the (app) route group.
 * Renders only a spinner while the layout loads menus and navigates
 * to the first menu item's component. Never displays real content.
 */
export default function EntryPage() {
  return (
    <div className="flex h-screen items-center justify-center">
      <Spinner size="lg" />
    </div>
  );
}
