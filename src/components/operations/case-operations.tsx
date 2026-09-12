"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, Upload, UsersRound } from "lucide-react";

export interface OperationalCaseFilters {
  priority: "" | "low" | "medium" | "high" | "urgent";
  owner: string;
  aging: "" | "0-30" | "31-60" | "61-90" | "91+";
  promiseMissed: boolean;
  plan: boolean;
  dispute: boolean;
  dueToday: boolean;
  highValue: boolean;
  closed: boolean;
}

interface Assignee {
  id: string;
  label: string;
  role: string;
}

export const emptyOperationalFilters: OperationalCaseFilters = {
  priority: "", owner: "", aging: "", promiseMissed: false, plan: false,
  dispute: false, dueToday: false, highValue: false, closed: false,
};

export function CaseOperations({
  filters,
  onFilters,
  selectedIds,
  onComplete,
  onClearSelection,
}: {
  filters: OperationalCaseFilters;
  onFilters: (filters: OperationalCaseFilters) => void;
  selectedIds: string[];
  onComplete: () => void;
  onClearSelection: () => void;
}) {
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState("");
  const [reminderType, setReminderType] = useState<"friendly" | "formal" | "final">("friendly");

  useEffect(() => {
    void fetch("/api/operations/assignees", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { assignees?: Assignee[] }) => setAssignees(payload.assignees ?? []))
      .catch(() => setAssignees([]));
  }, []);

  const update = <K extends keyof OperationalCaseFilters>(key: K, value: OperationalCaseFilters[K]) => {
    onFilters({ ...filters, [key]: value });
  };

  async function bulkJson(body: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/operations/bulk", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (body.action === "export" && response.ok) {
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `collectboss-cases-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage(`Exported ${selectedIds.length} cases.`);
    } else {
      const payload = await response.json().catch(() => ({})) as { error?: string; affected?: number };
      if (!response.ok) setMessage(payload.error ?? "Bulk action failed.");
      else {
        setMessage(`Updated ${payload.affected ?? selectedIds.length} cases.`);
        onComplete();
      }
    }
    setBusy(false);
  }

  async function sendReminders() {
    if (!window.confirm(`Send ${reminderType} email reminders to eligible contacts in ${selectedIds.length} selected cases?`)) return;
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/operations/bulk-reminders", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ case_ids: selectedIds, reminder_type: reminderType, confirmation: true }),
    });
    const payload = await response.json().catch(() => ({})) as {
      error?: string; sent?: number; excluded?: number; failed?: number;
    };
    setMessage(response.ok || response.status === 207
      ? `Sent ${payload.sent ?? 0}; excluded ${payload.excluded ?? 0}; failed ${payload.failed ?? 0}.`
      : payload.error ?? "Bulk reminder delivery failed.");
    setBusy(false);
    onComplete();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/operations" className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">
          <Upload className="h-3.5 w-3.5" /> Import & duplicates
        </Link>
        <details className="relative">
          <summary className="cursor-pointer list-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700">
            Advanced filters
          </summary>
          <div className="absolute left-0 top-11 z-30 w-[min(92vw,620px)] rounded-xl border border-gray-200 bg-white p-4 shadow-xl">
            <div className="grid gap-3 sm:grid-cols-3">
              <FilterSelect label="Priority" value={filters.priority} onChange={(value) => update("priority", value as OperationalCaseFilters["priority"])}
                options={[["", "All priorities"], ["low", "Low"], ["medium", "Medium"], ["high", "High"], ["urgent", "Urgent"]]} />
              <FilterSelect label="Owner" value={filters.owner} onChange={(value) => update("owner", value)}
                options={[["", "All owners"], ...assignees.map((item) => [item.id, `${item.label} · ${item.role}`])]} />
              <FilterSelect label="Aging" value={filters.aging} onChange={(value) => update("aging", value as OperationalCaseFilters["aging"])}
                options={[["", "Any age"], ["0-30", "0–30 days"], ["31-60", "31–60 days"], ["61-90", "61–90 days"], ["91+", "91+ days"]]} />
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {([
                ["promiseMissed", "Promise missed"], ["plan", "Active payment plan"],
                ["dispute", "Active dispute"], ["dueToday", "Due / follow-up today"],
                ["highValue", "High value (RM10,000+)"], ["closed", "Include closed"],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-xs text-gray-700">
                  <input type="checkbox" checked={filters[key]} onChange={(event) => update(key, event.target.checked)} />
                  {label}
                </label>
              ))}
            </div>
            <button type="button" onClick={() => onFilters(emptyOperationalFilters)} className="mt-4 text-xs font-semibold text-gray-500 hover:text-gray-800">
              Clear advanced filters
            </button>
          </div>
        </details>
      </div>

      {selectedIds.length > 0 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-bold text-emerald-900">{selectedIds.length} selected</span>
            <select
              aria-label="Assign selected cases"
              disabled={busy}
              defaultValue=""
              onChange={(event) => {
                if (event.target.value) void bulkJson({ action: "assign_owner", case_ids: selectedIds, owner_id: event.target.value });
                event.target.value = "";
              }}
              className="rounded-lg border border-emerald-200 bg-white px-2 py-1.5 text-xs"
            >
              <option value="">Assign owner…</option>
              {assignees.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
            <input type="datetime-local" value={followUp} onChange={(event) => setFollowUp(event.target.value)}
              className="rounded-lg border border-emerald-200 bg-white px-2 py-1.5 text-xs" />
            <button disabled={busy || !followUp} onClick={() => void bulkJson({
              action: "follow_up", case_ids: selectedIds, follow_up_at: new Date(followUp).toISOString(),
            })} className="rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold text-emerald-800 disabled:opacity-50">
              Set follow-up
            </button>
            <button disabled={busy} onClick={() => void bulkJson({ action: "export", case_ids: selectedIds })}
              className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold text-emerald-800 disabled:opacity-50">
              <Download className="h-3.5 w-3.5" /> Export
            </button>
            <select value={reminderType} onChange={(event) => setReminderType(event.target.value as typeof reminderType)}
              className="rounded-lg border border-emerald-200 bg-white px-2 py-1.5 text-xs">
              <option value="friendly">Friendly reminder</option>
              <option value="formal">Formal reminder</option>
              <option value="final">Final reminder</option>
            </select>
            <button disabled={busy} onClick={() => void sendReminders()}
              className="inline-flex items-center gap-1 rounded-lg bg-[#0D1B3D] px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              <UsersRound className="h-3.5 w-3.5" /> Send approved email
            </button>
            <button disabled={busy} onClick={onClearSelection} className="ml-auto text-xs font-semibold text-gray-500">Clear</button>
          </div>
          {message && <p className="mt-2 text-xs text-emerald-900">{message}</p>}
        </div>
      )}
    </div>
  );
}

function FilterSelect({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: string[][];
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-xs font-semibold text-gray-600">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs font-normal text-gray-800">
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
    </label>
  );
}

