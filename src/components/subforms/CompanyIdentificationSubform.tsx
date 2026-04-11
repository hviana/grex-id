"use client";

import { forwardRef, useImperativeHandle, useState } from "react";
import type { SubformRef } from "@/src/components/shared/GenericList";

interface CompanyIdentificationSubformProps {
  initialData?: Record<string, unknown>;
}

const CompanyIdentificationSubform = forwardRef<
  SubformRef,
  CompanyIdentificationSubformProps
>(
  ({ initialData }, ref) => {
    const [name, setName] = useState((initialData?.name as string) ?? "");
    const [document, setDocument] = useState(
      (initialData?.document as string) ?? "",
    );
    const [documentType, setDocumentType] = useState(
      (initialData?.documentType as string) ?? "cnpj",
    );

    useImperativeHandle(ref, () => ({
      getData: () => ({ name, document, documentType }),
      isValid: () => name.trim().length > 0 && document.trim().length > 0,
    }));

    const inputCls =
      "w-full rounded-lg border border-[var(--color-dark-gray)] bg-white/5 px-4 py-2.5 text-white outline-none focus:border-[var(--color-primary-green)] transition-colors";

    return (
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
            Company Name *
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
            Document Type *
          </label>
          <select
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value)}
            className={inputCls}
          >
            <option value="cnpj" className="bg-[var(--color-black)]">
              CNPJ
            </option>
            <option value="ein" className="bg-[var(--color-black)]">EIN</option>
            <option value="other" className="bg-[var(--color-black)]">
              Other
            </option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--color-light-text)] mb-1">
            Document Number *
          </label>
          <input
            type="text"
            value={document}
            onChange={(e) => setDocument(e.target.value)}
            required
            className={inputCls}
          />
        </div>
      </div>
    );
  },
);

CompanyIdentificationSubform.displayName = "CompanyIdentificationSubform";
export default CompanyIdentificationSubform;
