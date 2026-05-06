"use client";

import { Suspense, useMemo } from "react";
import { useParams } from "next/navigation";
import Spinner from "@/src/components/shared/Spinner";
import { getComponent } from "@/src/frontend-registry";

export default function DynamicRoutePage() {
  const params = useParams();
  const slugParts = params.slug as string[];
  const componentName = slugParts?.join("/") ?? "usage";

  const Component = useMemo(() => {
    return getComponent(componentName);
  }, [componentName]);

  if (!Component) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="text-4xl mb-4">🔍</div>
          <p className="text-[var(--color-light-text)]">
            Page not found: {componentName}
          </p>
        </div>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      }
    >
      <Component />
    </Suspense>
  );
}
