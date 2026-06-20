/**
 * Derives aggregate analytics from a CaseRow array.
 * Used by Reports page and both dashboards.
 * Security: caller must supply only cases for the current user's business.
 */

import { type CaseRow } from "@/lib/supabase/types";

export interface AgeBucket {
  label:  string;
  count:  number;
  amount: number;
  color:  string;
}

export interface CaseStats {
  // Counts
  total:              number;
  active:             number;
  paid:               number;
  overdue:            number;
  actionNeeded:       number;
  partialPaid:        number;
  paymentPromise:     number;
  formalDemandReady:  number;
  smallClaimEligible: number;

  // Amounts
  totalToCollect:  number;
  totalAmountOwed: number;
  totalRecovered:  number;
  overdueAmount:   number;
  paidAmount:      number;

  // Derived
  recoveryRate: number;   // 0–100 %

  // Breakdown
  byStatus: Array<{ label: string; count: number; color: string; bg: string }>;

  // Overdue age buckets
  ageBuckets: AgeBucket[];

  // Top lists
  topOverdue: CaseRow[];
  topActive:  CaseRow[];
  recentCases: CaseRow[];
}

export function computeCaseStats(cases: CaseRow[]): CaseStats {
  const SC_LIMIT = 5000;

  const activeCases  = cases.filter((c) => c.status !== "paid");
  const paidCases    = cases.filter((c) => c.status === "paid");
  const overdueCases = cases.filter((c) => c.days_overdue > 0 && c.status !== "paid");

  const byStatusKey: Record<string, number> = {};
  for (const c of cases) byStatusKey[c.status] = (byStatusKey[c.status] ?? 0) + 1;

  const statusMeta: Array<{ key: string; label: string; color: string; bg: string }> = [
    { key: "overdue",            label: "Overdue",             color: "bg-red-500",    bg: "text-red-700"    },
    { key: "action_needed",      label: "Action Needed",       color: "bg-purple-500", bg: "text-purple-700" },
    { key: "formal_demand_ready",label: "Formal Demand Ready", color: "bg-orange-500", bg: "text-orange-700" },
    { key: "payment_promise",    label: "Payment Promise",     color: "bg-amber-400",  bg: "text-amber-700"  },
    { key: "partial_paid",       label: "Partial Paid",        color: "bg-blue-500",   bg: "text-blue-700"   },
    { key: "paid",               label: "Paid",                color: "bg-emerald-500",bg: "text-emerald-700"},
  ];

  const byStatus = statusMeta
    .map((s) => ({ label: s.label, count: byStatusKey[s.key] ?? 0, color: s.color, bg: s.bg }))
    .filter((s) => s.count > 0);

  const age0_30   = overdueCases.filter((c) => c.days_overdue > 0  && c.days_overdue <= 30);
  const age31_60  = overdueCases.filter((c) => c.days_overdue > 30 && c.days_overdue <= 60);
  const age61_90  = overdueCases.filter((c) => c.days_overdue > 60 && c.days_overdue <= 90);
  const age91plus = overdueCases.filter((c) => c.days_overdue > 90);

  const bucketAmt = (arr: CaseRow[]) => arr.reduce((s, c) => s + c.balance, 0);

  const ageBuckets: AgeBucket[] = [
    { label: "0–30 days",  count: age0_30.length,   amount: bucketAmt(age0_30),   color: "bg-amber-400"  },
    { label: "31–60 days", count: age31_60.length,  amount: bucketAmt(age31_60),  color: "bg-orange-500" },
    { label: "61–90 days", count: age61_90.length,  amount: bucketAmt(age61_90),  color: "bg-red-500"    },
    { label: "91+ days",   count: age91plus.length, amount: bucketAmt(age91plus), color: "bg-red-700"    },
  ];

  const totalToCollect  = activeCases.reduce((s, c) => s + c.balance, 0);
  const totalAmountOwed = cases.reduce((s, c) => s + c.amount_owed, 0);
  const totalRecovered  = cases.reduce((s, c) => s + c.amount_paid, 0);
  const overdueAmount   = overdueCases.reduce((s, c) => s + c.balance, 0);
  const paidAmount      = paidCases.reduce((s, c) => s + c.amount_paid, 0);
  const recoveryRate    = totalAmountOwed > 0
    ? Math.min(100, Math.round((totalRecovered / totalAmountOwed) * 100))
    : 0;

  return {
    total:              cases.length,
    active:             activeCases.length,
    paid:               paidCases.length,
    overdue:            overdueCases.length,
    actionNeeded:       byStatusKey["action_needed"] ?? 0,
    partialPaid:        byStatusKey["partial_paid"] ?? 0,
    paymentPromise:     byStatusKey["payment_promise"] ?? 0,
    formalDemandReady:  byStatusKey["formal_demand_ready"] ?? 0,
    smallClaimEligible: activeCases.filter((c) => c.balance <= SC_LIMIT).length,
    totalToCollect,
    totalAmountOwed,
    totalRecovered,
    overdueAmount,
    paidAmount,
    recoveryRate,
    byStatus,
    ageBuckets: ageBuckets.filter((b) => b.count > 0),
    topOverdue:  [...overdueCases].sort((a, b) => b.balance - a.balance).slice(0, 5),
    topActive:   [...activeCases].sort((a, b) => b.balance - a.balance).slice(0, 5),
    recentCases: [...cases].sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    ).slice(0, 6),
  };
}
