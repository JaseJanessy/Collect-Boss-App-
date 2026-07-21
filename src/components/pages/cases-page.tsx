"use client";

import { useDeferredValue, useState } from "react";
import Link from "next/link";
import { CaseCard } from "@/components/ui/case-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { formatRM } from "@/lib/mock-data";
import { useCases } from "@/hooks/use-cases";
import { Search, FolderOpen, AlertCircle, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

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
  const [search, setSearch]             = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const deferredSearch = useDeferredValue(search);
  const caseStatus = activeFilter === "all" ? undefined : activeFilter as "action_needed" | "payment_promise" | "paid";
  const { cases, loading, loadingMore, error, total, hasMore, refresh, loadMore } = useCases({
    query: deferredSearch,
    status: caseStatus,
  });

  const filtered = cases;

  /* ── Dashboard (table) ─────────────────────────────────────── */
  if (dashboard) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Cases</h1>
            <p className="text-sm text-gray-500 mt-0.5">See which customers need follow-up.</p>
          </div>
          <Link
            href="/add"
            className="flex items-center gap-1.5 bg-[#009966] hover:bg-[#00B377] text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
          >
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

        {loading ? (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
            <LoadingSpinner />
          </div>
        ) : error ? (
          <ErrorBanner message={error} onRetry={refresh} />
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  {["Case ID", "Company", "Amount Due", "Due Date", "Status", "Action"].map((h, i) => (
                    <th
                      key={h}
                      className={cn(
                        "px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide",
                        i === 2 ? "text-right" : "text-left"
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
                    <td className="px-4 py-3 text-xs text-gray-500 font-mono">{c.id}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-900">{c.debtor_name}</p>
                      {c.debtor_location && (
                        <p className="text-xs text-gray-400">{c.debtor_location}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <p className="font-bold text-gray-900">
                        {formatRM(c.balance > 0 ? c.balance : c.amount_paid)}
                      </p>
                      {c.days_overdue > 0 && (
                        <p className="text-xs text-red-500">{c.days_overdue}d overdue</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">{c.due_date}</td>
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
            </table>
            </div>
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
          </div>
        )}
      </div>
    );
  }

  /* ── Mobile (cards) ────────────────────────────────────────── */
  return (
    <div className="flex flex-col pb-6">
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
            className="w-full pl-9 pr-4 py-2.5 bg-[#F2F4F7] rounded-xl text-sm text-gray-700 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-emerald-200 transition-all border border-transparent focus:border-emerald-200"
          />
        </div>

        <div className="flex gap-2 mt-3 overflow-x-auto scrollbar-hide pb-0.5">
          {filters.map((f) => (
            <button
              key={f.value}
              onClick={() => setActiveFilter(f.value)}
              className={cn(
                "shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all",
                activeFilter === f.value
                  ? "bg-[#0D1B3D] text-white border-[#0D1B3D]"
                  : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
              )}
            >
              {f.emoji && <span className="mr-1">{f.emoji}</span>}
              {f.label}
            </button>
          ))}
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
              <CaseCard key={c.id} case={c} />
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
    <div className="flex items-start gap-3 bg-red-50 border border-red-100 rounded-xl p-4">
      <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-red-700">Failed to load cases</p>
        <p className="text-[11px] text-red-500 mt-0.5 break-words">{message}</p>
      </div>
      <button
        onClick={onRetry}
        className="shrink-0 text-xs font-semibold text-red-600 hover:text-red-700"
      >
        Retry
      </button>
    </div>
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
          placeholder="Search by customer or case ID"
          className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition-all"
        />
      </div>
      <div className="flex gap-2 overflow-x-auto scrollbar-hide">
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => setActiveFilter(f.value)}
            className={cn(
              "shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all",
              activeFilter === f.value
                ? "bg-[#0D1B3D] text-white border-[#0D1B3D]"
                : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );
}
