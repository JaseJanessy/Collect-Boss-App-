"use client";

import { useMemo, useState } from "react";
import { Eye, Lock, MessageCircle, Banknote, HandCoins, FileText, RefreshCw } from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { cn } from "@/lib/utils";
import { filterCaseTimeline, type CaseTimelineEvent, type TimelineFilter } from "@/lib/timeline/model";
import { useRegion } from "@/contexts/region-context";
import { formatDateTime, formatMinorCurrency } from "@/lib/international/formatting";

const FILTERS: Array<{ id: TimelineFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "communication", label: "Communication" },
  { id: "payments", label: "Payments" },
  { id: "promises", label: "Promises" },
  { id: "documents", label: "Documents" },
  { id: "case_changes", label: "Case Changes" },
];

const icons = {
  communication: MessageCircle,
  payments: Banknote,
  promises: HandCoins,
  documents: FileText,
  case_changes: RefreshCw,
};

export function UnifiedCaseTimeline({
  currency, events, loading, error,
}: {
  currency: string;
  events: CaseTimelineEvent[];
  loading: boolean;
  error: string | null;
}) {
  const { configuration } = useRegion();
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const visible = useMemo(() => filterCaseTimeline(events, filter), [events, filter]);

  return <SectionCard title="Unified Case Timeline">
    <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Timeline filters">
      {FILTERS.map((item) => <button
        key={item.id} type="button" onClick={() => setFilter(item.id)}
        className={cn(
          "shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-bold",
          filter === item.id ? "border-[#009966] bg-emerald-50 text-[#007A52]" : "border-gray-200 bg-white text-gray-500",
        )}
      >{item.label}</button>)}
    </div>
    {loading && <p className="mt-4 text-xs text-gray-500">Loading complete case history…</p>}
    {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-xs text-red-700">{error}</p>}
    {!loading && !error && visible.length === 0 && <p className="mt-4 rounded-xl bg-gray-50 p-4 text-center text-xs text-gray-500">No events match this filter.</p>}
    {!loading && !error && visible.length > 0 && <ol className="mt-4 space-y-0 border-l-2 border-gray-100 pl-5">
      {visible.map((item) => {
        const Icon = icons[item.category];
        const amount = item.amount_minor == null
          ? null
          : formatMinorCurrency(BigInt(item.amount_minor), configuration.settings, currency);
        return <li key={item.id} className="relative pb-5 last:pb-1">
          <span className="absolute -left-[30px] top-0 flex h-5 w-5 items-center justify-center rounded-full bg-white ring-2 ring-gray-100">
            <Icon className="h-3 w-3 text-[#009966]" />
          </span>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold text-[#0D1B3D]">{item.summary}</p>
              <p className="mt-0.5 text-[10px] text-gray-400">
                {item.actor.type.replaceAll("_", " ")}
                {item.channel ? ` · ${item.channel}` : ""}
                {amount ? ` · ${amount}` : ""}
              </p>
            </div>
            <time className="shrink-0 text-right text-[10px] text-gray-400" dateTime={item.occurred_at}>
              {formatDateTime(item.occurred_at, configuration.settings)}
            </time>
          </div>
          <p className="mt-1 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-gray-400">
            {item.visibility === "internal_only" ? <Lock className="h-2.5 w-2.5" /> : <Eye className="h-2.5 w-2.5" />}
            {item.visibility === "internal_only" ? "Internal Only" : "Customer Visible"}
          </p>
        </li>;
      })}
    </ol>}
  </SectionCard>;
}
