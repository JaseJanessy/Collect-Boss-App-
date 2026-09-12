"use client";

import Link from "next/link";
import { Check, ChevronRight, Clock3, Filter, Play, RefreshCw, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { loadActionCentre, transitionAction } from "@/lib/action-centre/client";
import {
  actionQueueLabels,
  actionQueues,
  formatActionAge,
  type ActionQueue,
} from "@/lib/action-centre/priority";
import type {
  ActionCentreFilters,
  ActionCentrePayload,
  ActionCentreScope,
  ActionCentreTransition,
  ActionCentreViewItem,
} from "@/lib/action-centre/types";
import type { ActionCentrePriority } from "@/lib/supabase/types";
import { useRegion } from "@/contexts/region-context";
import { formatDateTime, formatMinorCurrency } from "@/lib/international/formatting";
import type { RegionSettings } from "@/lib/international/types";

const emptyPayload: ActionCentrePayload = {
  items: [],
  summary: {
    actionCount: 0,
    amountMinor: 0,
    actionableCaseCount: 0,
    totalsByCurrency: [],
    byPriority: {},
    byQueue: {},
  },
  filters: { owners: [], queues: [], caseTypes: [] },
  page: { nextCursor: null, hasMore: false },
  permissions: { canFilterTeam: false },
};

const priorityStyle: Record<ActionCentrePriority, string> = {
  critical: "border-red-200 bg-red-50 text-red-800",
  high: "border-orange-200 bg-orange-50 text-orange-800",
  medium: "border-amber-200 bg-amber-50 text-amber-800",
  low: "border-blue-200 bg-blue-50 text-blue-800",
};

const caseTypeLabels: Record<string, string> = {
  standalone: "Standalone",
  single_obligation: "Single invoice",
  multiple_obligations: "Multiple invoices",
  account_balance: "Account balance",
};

function money(minor: number, currency: string, settings: RegionSettings, explicitCode = false) {
  const formatted = formatMinorCurrency(minor, settings, currency);
  return explicitCode && !formatted.includes(currency) ? `${currency} ${formatted}` : formatted;
}

function dueLabel(value: string | null, settings: RegionSettings) {
  if (!value) return "No fixed due date";
  return formatDateTime(value, settings, { dateStyle: "medium", timeStyle: "short" });
}

function ActionRow({
  item,
  history,
  busy,
  onTransition,
}: {
  item: ActionCentreViewItem;
  history: boolean;
  busy: boolean;
  onTransition: (item: ActionCentreViewItem, action: ActionCentreTransition, snoozedUntil?: string) => void;
}) {
  const { configuration } = useRegion();
  const settings = configuration.settings;
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby={`action-${item.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide", priorityStyle[item.priority])}>
              {item.priority} severity
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
              {actionQueueLabels[item.queue]}
            </span>
          </div>
          <h3 id={`action-${item.id}`} className="mt-2 break-words text-sm font-black text-[#0D1B3D]">{item.title}</h3>
          <p className="mt-1 text-xs font-semibold text-slate-700">{item.customer_name}</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">{item.reason}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-black text-[#0D1B3D]">{money(item.amount_minor, item.currency, settings)}</p>
          <p className="mt-0.5 text-[10px] text-slate-400">value involved</p>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-[11px] sm:grid-cols-5" aria-label="Action priority details">
        <div><dt className="text-slate-400">Owner</dt><dd className="mt-0.5 font-bold text-slate-700">{item.owner_name}</dd></div>
        <div><dt className="text-slate-400">Age</dt><dd className="mt-0.5 font-bold text-slate-700">{formatActionAge(item.age_seconds)}</dd></div>
        <div><dt className="text-slate-400">Outstanding</dt><dd className="mt-0.5 font-bold text-slate-700">{money(item.outstanding_minor, item.currency, settings)}</dd></div>
        <div><dt className="text-slate-400">Due</dt><dd className="mt-0.5 font-bold text-slate-700">{dueLabel(item.due_at, settings)}</dd></div>
        <div><dt className="text-slate-400">Case type</dt><dd className="mt-0.5 font-bold text-slate-700">{item.case_type ? caseTypeLabels[item.case_type] ?? item.case_type : "Business-wide"}</dd></div>
      </dl>

      {item.contact_guard && item.contact_guard.warnings.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-bold text-amber-900">{item.contact_guard.recommended_action}</p>
          {item.contact_guard.warnings.map((warning) => <p key={warning} className="mt-1 text-[11px] text-amber-800">{warning}</p>)}
          <p className="mt-1.5 text-[10px] text-amber-700">Operational recommendation only; review the case before deciding.</p>
        </div>
      )}

      {!history && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Link
            href={item.href}
            onClick={() => { if (item.status === "open") onTransition(item, "start"); }}
            aria-label={`${item.recommended_action}: ${item.title}`}
            className="flex items-center gap-1.5 rounded-lg bg-[#009966] px-3 py-2 text-xs font-bold text-white hover:bg-[#007A52]"
          >
            {item.contact_guard?.warnings.length ? "Review case" : item.recommended_action}
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
          {item.status === "open" && (
            <button type="button" disabled={busy} onClick={() => onTransition(item, "start")} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              <Play className="h-3.5 w-3.5" /> Start
            </button>
          )}
          <select
            aria-label={`Snooze ${item.title}`}
            disabled={busy}
            defaultValue=""
            onChange={(event) => {
              const hours = Number(event.target.value);
              if (!hours) return;
              onTransition(item, "snooze", new Date(Date.now() + hours * 3_600_000).toISOString());
              event.target.value = "";
            }}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-600"
          >
            <option value="" disabled>Snooze…</option>
            <option value="1">1 hour</option><option value="24">1 day</option><option value="72">3 days</option><option value="168">7 days</option>
          </select>
          <button type="button" disabled={busy} onClick={() => onTransition(item, "complete")} className="flex items-center gap-1 rounded-lg border border-emerald-200 px-2.5 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
            <Check className="h-3.5 w-3.5" /> Complete
          </button>
          <button type="button" disabled={busy} onClick={() => onTransition(item, "dismiss")} aria-label={`Dismiss ${item.title}`} className="rounded-lg border border-slate-200 p-2 text-slate-400 hover:bg-slate-50 disabled:opacity-50">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </article>
  );
}

export function ActionCentrePanel({ compact = false, allowHistory = false }: { compact?: boolean; allowHistory?: boolean }) {
  const { configuration } = useRegion();
  const [scope, setScope] = useState<ActionCentreScope>("active");
  const [filters, setFilters] = useState<ActionCentreFilters>({});
  const [payload, setPayload] = useState<ActionCentrePayload>(emptyPayload);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchPage = useCallback(async (cursor?: string | null, append = false) => {
    try {
      setError(null);
      const result = await loadActionCentre(scope, filters, cursor, compact ? 5 : 25);
      setPayload((current) => append ? { ...result, items: [...current.items, ...result.items] } : result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load Action Centre.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [compact, filters, scope]);

  useEffect(() => {
    void Promise.resolve().then(() => {
      setLoading(true);
      return fetchPage();
    });
  }, [fetchPage]);

  const handleTransition = async (item: ActionCentreViewItem, action: ActionCentreTransition, snoozedUntil?: string) => {
    setBusyId(item.id);
    try {
      await transitionAction(item.id, action, snoozedUntil);
      await fetchPage();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update action.");
    } finally {
      setBusyId(null);
    }
  };
  const summaryMoney = payload.summary.totalsByCurrency.length > 0
    ? payload.summary.totalsByCurrency.map((total) => money(total.amountMinor, total.currency, configuration.settings, payload.summary.totalsByCurrency.length > 1)).join(" · ")
    : money(payload.summary.amountMinor, configuration.settings.defaultCurrency, configuration.settings);
  const filterCount = Object.values(filters).filter(Boolean).length;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="action-centre-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700">Highest priority first</p>
          <h2 id="action-centre-heading" className={cn("font-black text-[#0D1B3D]", compact ? "text-lg" : "text-2xl")}>What needs attention</h2>
          <p className="mt-0.5 text-xs text-slate-500">Operational work ordered by severity, due time, then age—not notification history.</p>
        </div>
        {allowHistory && (
          <div className="flex rounded-xl border border-slate-200 bg-white p-1" aria-label="Action status view">
            {(["active", "history"] as ActionCentreScope[]).map((item) => (
              <button type="button" key={item} onClick={() => setScope(item)} className={cn("rounded-lg px-3 py-1.5 text-xs font-bold capitalize", scope === item ? "bg-[#0D1B3D] text-white" : "text-slate-500")}>{item}</button>
            ))}
          </div>
        )}
      </div>

      {!loading && !error && scope === "active" && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SummaryCard label="Critical" value={String(payload.summary.byPriority.critical ?? 0)} tone="risk" />
          <SummaryCard label="High" value={String(payload.summary.byPriority.high ?? 0)} tone="attention" />
          <SummaryCard label="All actions" value={String(payload.summary.actionCount)} />
          <SummaryCard label="Outstanding represented" value={summaryMoney} compactValue />
        </div>
      )}

      {!loading && !error && !compact && scope === "active" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between"><p className="flex items-center gap-1.5 text-xs font-black text-[#0D1B3D]"><Filter className="h-3.5 w-3.5" /> Filters {filterCount ? `(${filterCount})` : ""}</p>{filterCount > 0 && <button type="button" onClick={() => setFilters({})} className="flex items-center gap-1 text-[11px] font-bold text-emerald-700"><RotateCcw className="h-3 w-3" /> Reset</button>}</div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <FilterSelect label="Team member" value={filters.owner ?? ""} onChange={(owner) => setFilters((current) => ({ ...current, owner: owner || undefined }))} disabled={!payload.permissions.canFilterTeam}>
              <option value="">All permitted owners</option>
              {payload.filters.owners.map((owner) => <option key={owner.id} value={owner.id === "unassigned" ? "unassigned" : owner.id}>{owner.label}</option>)}
            </FilterSelect>
            <FilterSelect label="Queue" value={filters.queue ?? ""} onChange={(queue) => setFilters((current) => ({ ...current, queue: queue ? queue as ActionQueue : undefined }))}>
              <option value="">All queues</option>{actionQueues.map((queue) => <option key={queue} value={queue}>{actionQueueLabels[queue]}</option>)}
            </FilterSelect>
            <FilterSelect label="Case type" value={filters.caseType ?? ""} onChange={(caseType) => setFilters((current) => ({ ...current, caseType: caseType || undefined }))}>
              <option value="">All case types</option>{payload.filters.caseTypes.map((caseType) => <option key={caseType} value={caseType}>{caseTypeLabels[caseType] ?? caseType}</option>)}
            </FilterSelect>
            <FilterSelect label="Severity" value={filters.severity ?? ""} onChange={(severity) => setFilters((current) => ({ ...current, severity: severity ? severity as ActionCentrePriority : undefined }))}>
              <option value="">All severities</option>{(["critical", "high", "medium", "low"] as const).map((priority) => <option key={priority} value={priority}>{priority}</option>)}
            </FilterSelect>
            <FilterSelect label="Due date" value={filters.due ?? ""} onChange={(due) => setFilters((current) => ({ ...current, due: due ? due as ActionCentreFilters["due"] : undefined }))}>
              <option value="">Any due date</option><option value="overdue">Overdue now</option><option value="today">Due today</option><option value="next_7_days">Next 7 days</option><option value="no_due_date">No due date</option>
            </FilterSelect>
          </div>
          {!payload.permissions.canFilterTeam && <p className="mt-2 text-[10px] text-slate-500">Your role can view only work assigned to you or left unassigned.</p>}
        </div>
      )}

      {loading && <div role="status" className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Loading priority work…</div>}
      {error && <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800"><span>{error}</span><button type="button" onClick={() => void fetchPage()} className="flex items-center gap-1 font-bold"><RefreshCw className="h-3.5 w-3.5" /> Retry</button></div>}
      {!loading && !error && payload.items.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <Clock3 className="mx-auto h-7 w-7 text-slate-300" />
          <p className="mt-2 text-sm font-bold text-slate-700">{scope === "history" ? "No completed action history yet" : filterCount ? "No priority work matches these filters" : "Nothing requires attention now"}</p>
          <p className="mt-1 text-xs text-slate-500">{scope === "history" ? "Completed and dismissed work will appear here." : filterCount ? "Reset filters to return to the full permitted queue." : "New verified queue items will appear here automatically."}</p>
        </div>
      )}
      {!loading && !error && payload.items.map((item) => <ActionRow key={item.id} item={item} history={scope === "history"} busy={busyId === item.id} onTransition={handleTransition} />)}
      {!loading && !error && !compact && payload.page.hasMore && (
        <button type="button" disabled={loadingMore} onClick={() => { setLoadingMore(true); void fetchPage(payload.page.nextCursor, true); }} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-bold text-[#0D1B3D] hover:bg-slate-50 disabled:opacity-50">
          {loadingMore ? "Loading more…" : "Load more priority items"}
        </button>
      )}
      {!loading && !error && compact && payload.page.hasMore && <Link href="/actions" className="text-center text-xs font-bold text-[#007A52]">Open the full priority queue →</Link>}
    </section>
  );
}

function SummaryCard({ label, value, tone = "neutral", compactValue = false }: { label: string; value: string; tone?: "neutral" | "risk" | "attention"; compactValue?: boolean }) {
  return <div className={cn("rounded-xl border bg-white p-3", tone === "risk" ? "border-red-200" : tone === "attention" ? "border-orange-200" : "border-slate-200")}><p className="text-[10px] font-semibold uppercase text-slate-400">{label}</p><p className={cn("mt-1 font-black", compactValue ? "text-sm leading-tight" : "text-xl", tone === "risk" ? "text-red-800" : tone === "attention" ? "text-orange-800" : "text-[#0D1B3D]")}>{value}</p></div>;
}

function FilterSelect({ label, value, onChange, disabled, children }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean; children: React.ReactNode }) {
  return <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500"><span>{label}</span><select aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold normal-case tracking-normal text-slate-700 disabled:bg-slate-100 disabled:text-slate-400">{children}</select></label>;
}
