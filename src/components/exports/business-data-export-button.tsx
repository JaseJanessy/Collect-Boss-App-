"use client";

import { useState } from "react";
import { Database, Download } from "lucide-react";

function fileNameFromDisposition(disposition: string | null) {
  return disposition?.match(/filename="([^"]+)"/)?.[1] ?? `collectboss-business-data-${new Date().toISOString().slice(0, 10)}.json`;
}

export function BusinessDataExportButton() {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runExport() {
    setExporting(true);
    setError(null);
    try {
      const response = await fetch("/api/exports/business-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error ?? "Unable to export business data.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileNameFromDisposition(response.headers.get("Content-Disposition"));
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to export business data.");
    } finally {
      setExporting(false);
    }
  }

  return <div className="flex flex-col items-start gap-1">
    <button
      type="button"
      disabled={exporting}
      onClick={() => void runExport()}
      className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 disabled:cursor-wait disabled:opacity-60"
    >
      {exporting ? <Database className="h-3.5 w-3.5 animate-pulse" /> : <Download className="h-3.5 w-3.5" />}
      {exporting ? "Preparing export…" : "Export business data"}
    </button>
    {error && <p className="max-w-64 text-[11px] text-red-600">{error}</p>}
  </div>;
}
