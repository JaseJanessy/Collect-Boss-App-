"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useCases } from "@/hooks/use-cases";
import { usePaymentProofs } from "@/hooks/use-payment-proofs";
import { formatRM } from "@/lib/mock-data";
import type { ActionCentreItemRow } from "@/lib/supabase/types";
import {
  Send,
  Upload,
  FileText,
  Phone,
  Mail,
  Clock,
  CheckCircle2,
  BarChart2,
  Zap,
  ChevronRight,
  MessageCircle,
  AlertCircle,
  Plus,
} from "lucide-react";

interface ActionItem {
  id:          string;
  icon:        React.ReactNode;
  label:       string;
  description: string;
  successRate?: string;
  tag?:        string;
  tagColor?:   string;
  href?:       string;
}

const actionGroups: Array<{ group: string; items: ActionItem[] }> = [
  {
    group: "Communication",
    items: [
      {
        id:          "whatsapp",
        icon:        <Send className="w-5 h-5" />,
        label:       "Generate Reminder Message",
        description: "Compose WhatsApp / SMS reminder",
        successRate: "68%",
        tag:         "Most Effective",
        tagColor:    "bg-emerald-100 text-emerald-700",
        href:        "/cases",
      },
      {
        id:          "call",
        icon:        <Phone className="w-5 h-5" />,
        label:       "Log Phone Call",
        description: "Record call outcome and notes",
        tag:         "Coming Soon",
        tagColor:    "bg-gray-100 text-gray-500",
      },
      {
        id:          "email",
        icon:        <Mail className="w-5 h-5" />,
        label:       "Send Email Notice",
        description: "Formal written notice via email",
        tag:         "Coming Soon",
        tagColor:    "bg-gray-100 text-gray-500",
      },
    ],
  },
  {
    group: "Documentation",
    items: [
      {
        id:          "upload",
        icon:        <Upload className="w-5 h-5" />,
        label:       "Upload Evidence",
        description: "Invoices, DOs, photos, contracts",
        href:        "/cases",
      },
      {
        id:          "demand",
        icon:        <FileText className="w-5 h-5" />,
        label:       "Prepare Formal Payment Reminder",
        description: "Create a factual creditor payment notice",
        tag:         "Legal",
        tagColor:    "bg-orange-100 text-orange-700",
        href:        "/cases",
      },
    ],
  },
  {
    group: "Payment Tracking",
    items: [
      {
        id:          "promise",
        icon:        <Clock className="w-5 h-5" />,
        label:       "Record Promise to Pay",
        description: "Track promised payment date",
        tag:         "Coming Soon",
        tagColor:    "bg-gray-100 text-gray-500",
      },
      {
        id:          "payment",
        icon:        <CheckCircle2 className="w-5 h-5" />,
        label:       "Record Manual Payment",
        description: "Mark payment received (manual review required)",
        href:        "/cases",
      },
    ],
  },
  {
    group: "Analytics",
    items: [
      {
        id:          "reports",
        icon:        <BarChart2 className="w-5 h-5" />,
        label:       "View Reports",
        description: "Recovery trends and collection summary",
        href:        "/reports",
      },
    ],
  },
];

interface ActionsPageProps {
  dashboard?: boolean;
}

export function ActionsPage({ dashboard }: ActionsPageProps) {
  const { cases, loading } = useCases();
  const { submissions } = usePaymentProofs();
  const [planActions, setPlanActions] = useState<ActionCentreItemRow[]>([]);
  const [legalHandoffActions, setLegalActions] = useState<ActionCentreItemRow[]>([]);
  useEffect(() => {
    fetch("/api/action-centre", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const payload = await response.json() as { items?: ActionCentreItemRow[] };
      setPlanActions((payload.items ?? []).filter((item) => item.type === "payment_plan.missed"));
      setLegalActions((payload.items ?? []).filter((item) => item.type === "legal_handoff.documents_requested"));
    }).catch(() => {});
  }, []);
  const paymentProofActions = submissions.filter((item) => ["submitted", "under_review", "more_information_required", "pending_review"].includes(item.status));

  const urgentCases = cases.filter(
    (c) => c.status === "overdue" || c.status === "action_needed"
  ).slice(0, 5);

  return (
    <div className="flex flex-col pb-6">
      {/* Header */}
      {!dashboard ? (
        <div className="bg-white border-b border-gray-100 px-4 py-4">
          <h1 className="text-lg font-bold text-[#0D1B3D]">Actions</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Take action to recover your money faster.
          </p>
        </div>
      ) : (
        <div className="mb-5">
          <h1 className="text-xl font-bold text-gray-900">Actions</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Take action to recover your money faster.
          </p>
        </div>
      )}

      <div className={cn("flex flex-col gap-5", !dashboard && "px-4 pt-5")}>
        {/* Empty state: no cases yet */}
        {!loading && cases.length === 0 && (
          <div className="bg-emerald-50 border border-emerald-100 rounded-2xl px-5 py-5 flex gap-4 items-start">
            <Zap className="w-5 h-5 text-[#009966] shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-emerald-800">No cases yet — add one first</p>
              <p className="text-xs text-emerald-700 mt-1 leading-relaxed">
                Actions work on your existing cases. Create a case for a debtor, then come
                back here to send reminders, upload evidence, or record payments.
              </p>
              <Link
                href="/add"
                className="inline-flex items-center gap-1.5 mt-3 bg-[#009966] hover:bg-[#00B377] text-white text-xs font-bold px-3 py-2 rounded-xl transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Your First Case
              </Link>
            </div>
          </div>
        )}

        {/* Recommended action banner */}
        <RecommendedBanner />

        {planActions.length > 0 && (
          <SectionCard title={`Missed Plan Installments (${planActions.length})`}>
            <div className="mt-1 flex flex-col">
              {planActions.slice(0, 5).map((item, index) => (
                <Link key={item.id} href={item.href} className={cn("flex items-center gap-3 py-3", index < Math.min(planActions.length, 5) - 1 && "border-b border-gray-50")}>
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50"><AlertCircle className="h-4 w-4 text-red-600" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-gray-800">{item.title}</p>
                    <p className="truncate text-[11px] text-gray-500">{item.description}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-gray-300" />
                </Link>
              ))}
            </div>
          </SectionCard>
        )}

        {legalHandoffActions.length > 0 && (
          <SectionCard title={`Legal Handoff Requests (${legalHandoffActions.length})`}>
            <div className="mt-1 flex flex-col">
              {legalHandoffActions.slice(0, 5).map((item, index) => (
                <Link key={item.id} href={item.href} className={cn("flex items-center gap-3 py-3", index < Math.min(legalHandoffActions.length, 5) - 1 && "border-b border-gray-50")}>
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-purple-50"><FileText className="h-4 w-4 text-purple-700" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-gray-800">{item.title}</p>
                    <p className="truncate text-[11px] text-gray-500">{item.description}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-gray-300" />
                </Link>
              ))}
            </div>
          </SectionCard>
        )}

        {paymentProofActions.length > 0 && (
          <SectionCard title={`Payment Proofs (${paymentProofActions.length})`}>
            <div className="mt-1 flex flex-col">
              {paymentProofActions.slice(0, 5).map((item, index) => (
                <Link key={item.id} href="/payments" className={cn("flex items-center gap-3 py-3", index < Math.min(paymentProofActions.length, 5) - 1 && "border-b border-gray-50")}>
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50"><CheckCircle2 className="h-4 w-4 text-amber-600" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-gray-800">Review payment proof</p>
                    <p className="truncate text-[11px] text-gray-500">{item.case_id} · {formatRM(item.amount)}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-gray-300" />
                </Link>
              ))}
            </div>
          </SectionCard>
        )}

        {/* Cases needing reminder */}
        {(loading || urgentCases.length > 0) && (
          <SectionCard
            title="Cases Needing Action"
            action={
              <Link href="/cases" className="text-xs text-[#009966] font-semibold">
                View All →
              </Link>
            }
          >
            {loading ? (
              <div className="py-4"><LoadingSpinner className="py-2" /></div>
            ) : (
              <div className="flex flex-col mt-1">
                {urgentCases.map((c, i) => (
                  <div
                    key={c.id}
                    className={cn(
                      "flex items-center gap-3 py-3",
                      i < urgentCases.length - 1 && "border-b border-gray-50"
                    )}
                  >
                    <div className="w-8 h-8 bg-[#F2F4F7] rounded-lg flex items-center justify-center shrink-0">
                      <AlertCircle className="w-4 h-4 text-orange-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-gray-800 truncate">{c.debtor_name}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <StatusBadge status={c.status} />
                        <span className="text-[10px] text-gray-400">
                          {formatRM(c.balance > 0 ? c.balance : c.amount_owed)}
                        </span>
                      </div>
                    </div>
                    <Link
                      href={`/reminders/${c.id}`}
                      className="flex items-center gap-1 text-[11px] font-bold text-[#009966] bg-emerald-50 border border-emerald-200 px-2 py-1.5 rounded-lg hover:bg-emerald-100 transition-colors shrink-0"
                    >
                      <MessageCircle className="w-3 h-3" />
                      Remind
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        )}

        {/* Action groups */}
        {actionGroups.map((group) => (
          <SectionCard key={group.group} title={group.group}>
            <div className="flex flex-col mt-1">
              {group.items.map((item, i) => {
                const inner = (
                  <button
                    key={item.id}
                    disabled={!item.href}
                    className={cn(
                      "flex items-center gap-3 py-3.5 text-left -mx-4 px-4 transition-colors w-full",
                      item.href ? "hover:bg-gray-50" : "cursor-not-allowed opacity-60",
                      i < group.items.length - 1 && "border-b border-gray-50"
                    )}
                  >
                    <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center shrink-0 text-gray-600">
                      {item.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-gray-900">{item.label}</p>
                        {item.tag && (
                          <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full", item.tagColor)}>
                            {item.tag}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">{item.description}</p>
                      {item.successRate && (
                        <p className="text-[11px] text-emerald-600 font-semibold mt-0.5">
                          {item.successRate} Success Rate
                        </p>
                      )}
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
                  </button>
                );

                return item.href ? (
                  <Link key={item.id} href={item.href}>{inner}</Link>
                ) : inner;
              })}
            </div>
          </SectionCard>
        ))}

        {/* Legal notice */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-xs font-bold text-amber-800 mb-1">⚖️ Legal Compliance Notice</p>
          <p className="text-[11px] text-amber-700 leading-relaxed">
            All communications must comply with Malaysian consumer protection laws. Avoid
            threatening language. Do not contact the debtor&apos;s family, employer, or friends.
            Do not share debtor information publicly. Payments must be manually confirmed
            before marking as received.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Recommended action banner ────────────────────────────────────────────────

function RecommendedBanner() {
  const { cases } = useCases();
  const topCase = cases.find(
    (c) => c.status === "overdue" || c.status === "action_needed"
  );

  if (!topCase) return null;

  return (
    <div className="bg-[#0D1B3D] rounded-2xl p-4 text-white">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 bg-[#009966] rounded-lg flex items-center justify-center">
          <Zap className="w-4 h-4 text-white" />
        </div>
        <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wide">
          Recommended Now
        </span>
      </div>
      <p className="text-base font-bold text-white leading-snug">
        Send a reminder to {topCase.debtor_name}
      </p>
      <p className="text-xs text-blue-200 mt-1 leading-relaxed">
        {topCase.days_overdue > 0
          ? `${topCase.days_overdue} days overdue. Balance: ${formatRM(topCase.balance)}.`
          : `Action needed. Balance: ${formatRM(topCase.balance > 0 ? topCase.balance : topCase.amount_owed)}.`}
        {" "}A friendly reminder has a 68% success rate.
      </p>
      <Link href={`/reminders/${topCase.id}`}>
        <button className="mt-3 w-full bg-[#009966] hover:bg-[#00B377] text-white text-sm font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 transition-colors">
          <Send className="w-4 h-4" />
          Generate Reminder
        </button>
      </Link>
    </div>
  );
}
