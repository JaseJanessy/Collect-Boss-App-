"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";

const fields = [
  ["debtor_type", "Customer type"], ["customer_name", "Customer name *"],
  ["contact_name", "Contact name"], ["phone", "Phone"], ["email", "Email"],
  ["address", "Address"], ["registration_no", "Registration number"],
  ["account_number", "Account number"], ["account_name", "Account name"],
  ["account_type", "Account type"], ["obligation_type", "Obligation type"],
  ["reference", "Invoice / obligation reference *"], ["purchase_order_reference", "PO reference"],
  ["agreement_reference", "Agreement reference"], ["vehicle_registration", "Vehicle registration"],
  ["opening_outstanding", "Opening outstanding *"], ["issue_date", "Issue date"],
  ["due_date", "Due date *"], ["priority", "Priority"],
] as const;

interface Preview {
  file_name: string;
  file_type: "csv" | "xlsx";
  headers: string[];
  sample_rows: Array<Record<string, string>>;
  total_rows: number;
  suggested_mapping: Record<string, string>;
}

interface ImportReport {
  batch_id: string;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  duplicate_rows: number;
  can_commit: boolean;
  errors: Array<{ row_number: number; error_code: string; message: string }>;
  duplicates: Array<{
    row_number: number; identifiers: string[]; matched_customer_id: string | null;
    matched_customer_name: string | null; internal: boolean;
  }>;
  error?: string;
  result?: { imported?: number };
}

/**
 * CSV / Excel customer import: preview, map columns, check, then import all
 * rows together. Shared by Data operations and onboarding.
 */
export function CustomerImportPanel({ onImported }: { onImported?: (rows: number) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [report, setReport] = useState<ImportReport | null>(null);
  const [confirmDuplicates, setConfirmDuplicates] = useState(false);
  const [busy, setBusy] = useState<"preview" | "dry_run" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(action: "preview" | "dry_run" | "commit") {
    if (!file) return;
    setBusy(action);
    setError(null);
    const form = new FormData();
    form.set("file", file);
    form.set("action", action);
    if (action !== "preview") {
      form.set("mapping", JSON.stringify(mapping));
      form.set("confirm_duplicates", String(confirmDuplicates));
    }
    const response = await fetch("/api/operations/import", { method: "POST", body: form });
    const payload = await response.json().catch(() => ({})) as Preview & ImportReport & { error?: string };
    if (action === "preview" && response.ok) {
      setPreview(payload);
      setMapping(payload.suggested_mapping ?? {});
      setReport(null);
      setConfirmDuplicates(false);
    } else if (action !== "preview") {
      setReport(payload);
      if (!response.ok) setError(payload.error ?? "Import operation failed.");
      else if (action === "commit" && payload.result) onImported?.(payload.result.imported ?? payload.valid_rows);
    } else setError(payload.error ?? "Unable to preview the file.");
    setBusy(null);
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-gray-900"><FileSpreadsheet className="h-4 w-4 text-emerald-600" /> CSV / XLSX import</h2>
          <p className="mt-1 text-xs text-gray-500">Up to 5,000 rows and 10 MB. Each row becomes a customer with the amount they still owe. Download the template to see the columns.</p>
        </div>
        <a href="/api/operations/import/template" className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700">
          <Download className="h-3.5 w-3.5" /> Download template
        </a>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null); setPreview(null); setReport(null); setError(null);
          }} className="max-w-full text-xs text-gray-600" />
        <button disabled={!file || busy !== null} onClick={() => void submit("preview")}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#0D1B3D] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
          <Upload className="h-3.5 w-3.5" /> {busy === "preview" ? "Reading…" : "Preview file"}
        </button>
      </div>

      {preview && (
        <div className="mt-5 space-y-4">
          <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
            <strong>{preview.file_name}</strong> · {preview.total_rows} rows · {preview.file_type.toUpperCase()}
          </div>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500">Column mapping</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {fields.map(([field, label]) => (
                <label key={field} className="text-xs font-semibold text-gray-600">
                  {label}
                  <select value={mapping[field] ?? ""} onChange={(event) => setMapping((current) => ({ ...current, [field]: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs font-normal text-gray-800">
                    <option value="">Not mapped</option>
                    {preview.headers.map((header) => <option key={header} value={header}>{header}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto rounded-lg border border-gray-100">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50"><tr>{preview.headers.map((header) => <th key={header} className="whitespace-nowrap px-3 py-2 text-left font-semibold text-gray-600">{header}</th>)}</tr></thead>
              <tbody>{preview.sample_rows.map((row, index) => <tr key={index} className="border-t border-gray-100">{preview.headers.map((header) => <td key={header} className="max-w-56 truncate px-3 py-2 text-gray-700">{row[header]}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <button disabled={busy !== null} onClick={() => void submit("dry_run")}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
            {busy === "dry_run" ? "Checking…" : "Check my file"}
          </button>
        </div>
      )}

      {report && (
        <div className="mt-5 rounded-xl border border-gray-200 p-4">
          <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            <Metric label="Total" value={report.total_rows} />
            <Metric label="Valid" value={report.valid_rows} />
            <Metric label="Invalid" value={report.invalid_rows} danger={report.invalid_rows > 0} />
            <Metric label="Duplicate warnings" value={report.duplicate_rows} danger={report.duplicate_rows > 0} />
          </div>
          {report.errors.length > 0 && (
            <div className="mt-4 rounded-lg border border-red-100 bg-red-50 p-3">
              <p className="flex items-center gap-1.5 text-xs font-bold text-red-700"><AlertTriangle className="h-4 w-4" /> Some rows need fixing. Nothing has been imported yet.</p>
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-red-700">
                {report.errors.slice(0, 50).map((item) => <li key={`${item.row_number}:${item.error_code}`}>Row {item.row_number}: {item.message}</li>)}
              </ul>
              <a href={`/api/operations/import/${report.batch_id}/errors`} className="mt-3 inline-block text-xs font-bold text-red-800 underline">Download complete error report</a>
            </div>
          )}
          {report.duplicates.length > 0 && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-bold text-amber-800">Reliable identifier matches require confirmation</p>
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-amber-800">
                {report.duplicates.slice(0, 50).map((item) => (
                  <li key={item.row_number}>Row {item.row_number}: {item.internal ? "matches another import row" : `matches ${item.matched_customer_name ?? item.matched_customer_id}`} ({item.identifiers.join(", ")})</li>
                ))}
              </ul>
              <label className="mt-3 flex items-start gap-2 text-xs font-semibold text-amber-900">
                <input type="checkbox" checked={confirmDuplicates} onChange={(event) => setConfirmDuplicates(event.target.checked)} />
                Link these rows to the confirmed matching customers. Do not merge or overwrite customer records.
              </label>
            </div>
          )}
          {report.result && (
            <p className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-xs font-bold text-emerald-800">
              <CheckCircle2 className="h-4 w-4" /> Imported {report.result.imported ?? report.valid_rows} rows.
            </p>
          )}
          {!report.result && report.invalid_rows === 0 && (
            <button disabled={busy !== null || (report.duplicate_rows > 0 && !confirmDuplicates)}
              onClick={() => void submit("commit")}
              className="mt-4 rounded-lg bg-[#0D1B3D] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
              {busy === "commit" ? "Importing…" : "Import customers"}
            </button>
          )}
        </div>
      )}
      {error && <p className="mt-3 text-xs font-semibold text-red-600">{error}</p>}
    </section>

  );
}

function Metric({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return <div className={`rounded-lg p-2 ${danger ? "bg-red-50 text-red-700" : "bg-gray-50 text-gray-700"}`}><p className="text-lg font-black">{value}</p><p className="text-[10px] font-semibold uppercase">{label}</p></div>;
}
