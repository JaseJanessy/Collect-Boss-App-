"use client";

import { useDeferredValue, useState } from "react";
import Link from "next/link";
import { CaseCard } from "@/components/ui/case-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useCases } from "@/hooks/use-cases";
import { Search, FolderOpen, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CaseOperations, emptyOperationalFilters, type OperationalCaseFilters,
} from "@/components/operations/case-operations";
import { useRegion } from "@/contexts/region-context";
import { formatCalendarDate, formatCurrency } from "@/lib/international/formatting";
import { Button, buttonVariants } from "@/components/ui/button";
import { DataTable, DataTableContainer } from "@/components/ui/data-table";
import { Alert } from "@/components/ui/feedback";
import { Tabs } from "@/components/ui/tabs";

const filters = [
  { label: "All",           value: "all",             emoji: "" },
  { label: "Action Needed", value: "action_needed",   emoji: "⚡" },
  { label: "Promises",      value: "payment_promise", emoji: "🤝" },
  { label: "Paid",          value: "paid",             emoji: "✅" },
];

interface CasesPageProps {
  dashboard?: boolean;
}

export function CasesPage({ dashboard }: CasesPageProps) {
  const { configuration } = useRegion();
  const [search, setSearch]             = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [operationalFilters, setOperationalFilters] = useState<OperationalCaseFilters>(emptyOperationalFilters);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const deferredSearch = useDeferredValue(search);
  const statuses = activeFilter === "all"
    ? []
    : [activeFilter as "action_needed" | "payment_promise" | "paid"];
  const aging = operationalFilters.aging === "0-30" ? { agingMin: 0, agingMax: 30 }
    : operationalFilters.aging === "31-60" ? { agingMin: 31, agingMax: 60 }
      : operationalFilters.aging === "61-90" ? { agingMin: 61, agingMax: 90 }
        : operationalFilters.aging === "91+" ? { agingMin: 91 } : {};
  const { cases, loading, loadingMore, error, total, hasMore, refresh, loadMore } = useCases({
    query: deferredSearch,
    statuses,
    priorities: operationalFilters.priority ? [operationalFilters.priority] : [],
    owner: operationalFilters.owner || undefined,
    ...aging,
    promiseMissed: operationalFilters.promiseMissed,
    plan: operationalFilters.plan,
    dispute: operationalFilters.dispute,
    dueToday: operationalFilters.dueToday,
    highValueMinor: operationalFilters.highValue ? 1_000_000 : undefined,
    closed: operationalFilters.closed,
  });

  const filtered = cases;
  const selectedIds = [...selected];
  const toggleSelected = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  /* ── Dashboard (table) ─────────────────────────────────────── */
  if (dashboard) {
    return (
      <div className="cb-analytics-light flex flex-col gap-5 text-slate-900">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Cases</h1>
            <p className="text-sm text-gray-500 mt-0.5">See which customers need follow-up.</p>
          </div>
          <Link href="/add" className={buttonVariants()}>
            <Plus className="w-4 h-4" />
            Add Case
          </Link>
        </div>

        <SearchAndFilters
          search={search}
          setSearch={setSearch}
          activeFilter={activeFilter}
          setActiveFilter={setActiveFilter}
        />
        <CaseOperations
          filters={operationalFilters}
          onFilters={setOperationalFilters}
          selectedIds={selectedIds}
          onComplete={refresh}
          onClearSelection={() => setSelected(new Set())}
        />

        {loading ? (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
            <LoadingSpinner />
          </div>
        ) : error ? (
          <ErrorBanner message={error} onRetry={refresh} />
        ) : (
          <DataTableContainer label="Cases">
            <DataTable>
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  {["", "Case ID", "Company", "Amount Due", "Due Date", "Status", "Action"].map((h, i) => (
                    <th
                      key={h}
                      className={cn(
                        "px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide",
                        i === 3 ? "text-right" : "text-left"
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50 cursor-pointer transition-colors">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Select case ${c.id}`}
                        checked={selected.has(c.id)}
                        onChange={() => toggleSelected(c.id)}
                      />
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 font-mono">{c.id}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-900">{c.debtor_name}</p>
                      {c.debtor_location && (
                        <p className="text-xs text-gray-400">{c.debtor_location}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <p className="font-bold text-gray-900">
                        {formatCurrency(c.balance > 0 ? c.balance : c.amount_paid, configuration.settings, c.currency ?? configuration.settings.defaultCurrency)}
                      </p>
                      {c.days_overdue > 0 && (
                        <p className="text-xs text-red-500">{c.days_overdue}d overdue</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">{formatCalendarDate(c.due_date, configuration.settings)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/cases/${c.id}`}
                        className="text-xs text-emerald-600 font-semibold hover:text-emerald-700"
                      >
                        View details →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            {filtered.length === 0 && (
              <EmptyState
                icon={<FolderOpen className="w-6 h-6" />}
                title={cases.length === 0 ? "No cases yet" : "No cases found"}
                description={
                  cases.length === 0
                    ? "Add your first case to start tracking debt recovery."
                    : "Try adjusting your search or filter."
                }
                action={
                  cases.length === 0 ? (
                    <Link href="/add" className={buttonVariants()}>
                      <Plus className="w-4 h-4" />
                      Add Your First Case
                    </Link>
                  ) : undefined
                }
              />
            )}
            {hasMore && (
              <div className="flex justify-center border-t border-gray-100 p-3">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loadingMore ? "Loading…" : `Load more (${cases.length} of ${total})`}
                </button>
              </div>
            )}
          </DataTableContainer>
        )}
      </div>
    );
  }

  /* ── Mobile (cards) ────────────────────────────────────────── */
  return (
    <div className="cb-light-surface flex flex-col pb-6">
      <div className="bg-white border-b border-gray-100 px-4 py-4">
        <h1 className="text-lg font-bold text-[#0D1B3D]">Cases</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          See which customers need follow-up.
        </p>

        <div className="relative mt-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by customer or case ID"
            aria-label="Search cases"
            className="cb-field cb-field-with-icon bg-slate-50"
          />
        </div>

        <Tabs className="mt-3" label="Case status" value={activeFilter} onValueChange={setActiveFilter} options={filters.map((filter) => ({ value: filter.value, label: filter.label }))} />
        <div className="mt-3">
          <CaseOperations
            filters={operationalFilters}
            onFilters={setOperationalFilters}
            selectedIds={selectedIds}
            onComplete={refresh}
            onClearSelection={() => setSelected(new Set())}
          />
        </div>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : error ? (
        <div className="px-4 pt-4">
          <ErrorBanner message={error} onRetry={refresh} />
        </div>
      ) : (
        <>
          <div className="px-4 py-3">
            <p className="text-xs text-gray-500 font-medium">
              {filtered.length} case{filtered.length !== 1 ? "s" : ""}
              {activeFilter !== "all" &&
                ` · ${filters.find((f) => f.value === activeFilter)?.label}`}
            </p>
          </div>

          <div className="px-4 flex flex-col gap-3">
            {filtered.map((c) => (
              <div key={c.id} className="relative">
                <label className="absolute right-3 top-3 z-10 rounded-full bg-white/90 p-1 shadow-sm">
                  <input
                    type="checkbox"
                    aria-label={`Select case ${c.id}`}
                    checked={selected.has(c.id)}
                    onChange={() => toggleSelected(c.id)}
                  />
                </label>
                <CaseCard case={c} />
              </div>
            ))}

            {filtered.length === 0 && (
              <EmptyState
                icon={<FolderOpen className="w-6 h-6" />}
                title={cases.length === 0 ? "No cases yet" : "No cases found"}
                description={
                  cases.length === 0
                    ? "Add your first case to start tracking debt recovery."
                    : "Try adjusting your search or filter."
                }
                action={
                  cases.length === 0 ? (
                    <Link
                      href="/add"
                      className="flex items-center gap-1.5 bg-[#009966] hover:bg-[#00B377] text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      Add Your First Case
                    </Link>
                  ) : undefined
                }
              />
            )}
            {hasMore && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="mt-1 w-full rounded-xl border border-emerald-200 py-2.5 text-xs font-semibold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loadingMore ? "Loading…" : `Load more (${cases.length} of ${total})`}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Error banner ──────────────────────────────────────────────────────────────

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Alert tone="error" title="Failed to load cases" action={<Button variant="outline" size="sm" onClick={onRetry}>Retry</Button>}><p>{message}</p></Alert>
  );
}

// ─── Shared search + filter bar ───────────────────────────────────────────────

function SearchAndFilters({
  search,
  setSearch,
  activeFilter,
  setActiveFilter,
}: {
  search: string;
  setSearch: (v: string) => void;
  activeFilter: string;
  setActiveFilter: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, phone, email, case, invoice, PO, agreement or vehicle"
          aria-label="Search cases"
          className="cb-field cb-field-with-icon"
        />
      </div>
      <Tabs label="Case status" value={activeFilter} onValueChange={setActiveFilter} options={filters.map((filter) => ({ value: filter.value, label: filter.label }))} />
    </div>
  );
}
