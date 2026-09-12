"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { StatusBadge } from "./status-badge";
import { type CaseRow } from "@/lib/supabase/types";
import { getInitials, getAvatarColor } from "@/lib/mock-data";
import { Calendar, MapPin, Send, ChevronRight } from "lucide-react";
import { useRegion } from "@/contexts/region-context";
import { formatCalendarDate, formatCurrency } from "@/lib/international/formatting";

interface CaseCardProps {
  case: CaseRow;
  className?: string;
  showAction?: boolean;
}

export function CaseCard({ case: c, className, showAction = true }: CaseCardProps) {
  const { configuration } = useRegion();
  const amountDisplay = c.balance > 0 ? c.balance : c.amount_paid;

  return (
    <Link
      href={`/cases/${c.id}`}
      className={cn(
        "block bg-white rounded-2xl border border-gray-100 shadow-sm p-4",
        "hover:shadow-md hover:border-gray-200 active:scale-[0.99] transition-all",
        className
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center text-white text-sm font-bold shrink-0",
            getAvatarColor(c.debtor_name)
          )}
        >
          {getInitials(c.debtor_name)}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-bold text-gray-900 text-sm leading-tight break-words">
                {c.debtor_name}
              </p>
              <p className="text-[11px] text-gray-400 mt-0.5">Case ID: {c.id}</p>
            </div>
            <StatusBadge status={c.status} className="shrink-0" />
          </div>

          <p className="text-lg font-black text-gray-900 mt-2 tracking-tight">
            {formatCurrency(amountDisplay, configuration.settings, c.currency ?? configuration.settings.defaultCurrency)}
          </p>

          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            <span className="flex items-center gap-1 text-[11px] text-gray-400">
              <Calendar className="w-3 h-3" />
              Due {formatCalendarDate(c.due_date, configuration.settings)}
            </span>
            {c.days_overdue > 0 && (
              <span className="text-[11px] text-red-500 font-semibold">
                {c.days_overdue} days overdue
              </span>
            )}
          </div>

          {c.debtor_location && (
            <div className="flex items-center gap-1 mt-1 text-[11px] text-gray-400">
              <MapPin className="w-3 h-3 shrink-0" />
              <span className="break-words">{c.debtor_location}</span>
            </div>
          )}
        </div>

        <ChevronRight className="w-4 h-4 text-gray-300 shrink-0 mt-1" />
      </div>

      {showAction && (c.status === "overdue" || c.status === "action_needed") && (
        <button
          onClick={(e) => e.preventDefault()}
          className="mt-3 w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl py-2.5 transition-colors"
        >
          <Send className="w-3.5 h-3.5" />
          Send Reminder
        </button>
      )}
    </Link>
  );
}
