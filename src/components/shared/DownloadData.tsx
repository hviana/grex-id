"use client";

import { useCallback, useState } from "react";
import * as XLSX from "xlsx";
import { useLocale } from "@/src/hooks/useLocale";
import Spinner from "./Spinner";

interface DownloadDataProps {
  data:
    | Record<string, unknown>[]
    | (() => Promise<Record<string, unknown>[]>);
  fileName?: string;
  sheetName?: string;
  label?: string;
}

export default function DownloadData({
  data,
  fileName = "export",
  sheetName = "sheet1",
  label = "common.download",
}: DownloadDataProps) {
  const { t } = useLocale();
  const [loading, setLoading] = useState(false);

  const handleDownload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = typeof data === "function" ? await data() : data;
      if (!rows || rows.length === 0) return;

      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

      const rawData = XLSX.write(workbook, {
        bookType: "xlsx",
        type: "array",
        compression: true,
      });

      const blob = new Blob([new Uint8Array(rawData)], {
        type:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${fileName}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } finally {
      setLoading(false);
    }
  }, [data, fileName, sheetName]);

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={loading}
      className="flex items-center gap-2 px-4 py-2 text-sm backdrop-blur-md bg-white/5 border border-dashed border-[var(--color-dark-gray)] rounded-lg hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[var(--color-light-green)]/20 hover:border-[var(--color-primary-green)] transition-all disabled:opacity-50 disabled:pointer-events-none text-[var(--color-light-text)]"
    >
      {loading ? <Spinner size="sm" /> : <span>📥</span>}
      <span>{loading ? t("common.download.exporting") : t(label)}</span>
    </button>
  );
}
