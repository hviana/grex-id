"use client";

import { useRef, useState } from "react";
import Modal from "./Modal.tsx";
import GenericFormButton from "./GenericFormButton.tsx";
import ErrorDisplay from "./ErrorDisplay.tsx";
import type { SubformConfig, SubformRef } from "./GenericList.tsx";
import { useTenantContext } from "@/src/hooks/useTenantContext";

interface FormModalProps {
  title: string;
  subforms: SubformConfig[];
  submitRoute: string;
  method: "POST" | "PUT";
  initialData?: Record<string, unknown>;
  onSuccess: () => void;
  onClose: () => void;
  authToken?: string | null;
  extraData?: Record<string, unknown>;
}

export default function FormModal({
  title,
  subforms,
  submitRoute,
  method,
  initialData,
  onSuccess,
  onClose,
  authToken,
  extraData,
}: FormModalProps) {
  const { t } = useTenantContext();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refs = useRef<Map<string, SubformRef>>(new Map());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    let allValid = true;
    const data: Record<string, unknown> = {};

    for (const [, ref] of refs.current) {
      if (!ref.isValid()) {
        allValid = false;
        break;
      }
      Object.assign(data, ref.getData());
    }

    if (!allValid) {
      setError(t("common.error.validation"));
      return;
    }

    setLoading(true);
    try {
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (authToken) {
        headers["Authorization"] = `Bearer ${authToken}`;
      }

      const payload = { ...data, ...extraData };
      if (method === "PUT" && initialData?.id) {
        payload.id = initialData.id;
      }

      const res = await fetch(submitRoute, {
        method,
        headers,
        body: JSON.stringify(payload),
      });
      const json = await res.json();

      if (!json.success) {
        setError(json.error?.message ?? t("common.error.generic"));
        return;
      }

      onSuccess();
    } catch {
      setError(t("common.error.network"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={title}>
      <form onSubmit={handleSubmit} className="space-y-6">
        <ErrorDisplay message={error} />

        {subforms.map((sf) => {
          const Component = sf.component;
          return (
            <Component
              key={sf.key}
              ref={(ref: SubformRef | null) => {
                if (ref) refs.current.set(sf.key, ref);
                else refs.current.delete(sf.key);
              }}
              initialData={initialData}
              {...(sf.extraProps ?? {})}
            />
          );
        })}

        <GenericFormButton
          loading={loading}
          label={method === "POST" ? t("common.create") : t("common.save")}
        />
      </form>
    </Modal>
  );
}
