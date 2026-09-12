"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatRM } from "@/lib/mock-data";
import { evidenceTypes } from "@/lib/mock-legal-data";
import { getLegalDocsByCaseClient } from "@/lib/db/legal-documents-client";
import { getReferralsByCaseClient } from "@/lib/db/lawyer-referrals-client";
import { useCases } from "@/hooks/use-cases";
import { useAllEvidence } from "@/hooks/use-all-evidence";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { type LegalDocumentRow, type LawyerReferralRow } from "@/lib/supabase/types";
import { REFERRAL_STATUS_CONFIG } from "@/lib/lawyer-referrals/status";
import { SMALL_CLAIM_STATUS_CONFIG } from "@/components/pages/legal/small-claim-page";
import {
  FileText, Upload, ShieldCheck, Gavel, ChevronRight, Download, Send, Info,
} from "lucide-react";

const DEMAND_DOC_TYPES = new Set(["demand_standard", "demand_firm", "demand_final"]);
const TONE_LABELS: Record<string, string> = {
  demand_standard: "Formal Payment Reminder",
  demand_firm:     "Firm Payment Reminder",
  demand_final:    "Final Payment Notice",
};

export function DocumentsIndexPage() {
  const [docsByCaseId,      setDocsByCaseId]      = useState<Record<string, LegalDocumentRow[]>>({});
  const [referralsByCaseId, setReferralsByCaseId] = useState<Record<string, LawyerReferralRow[]>>({});
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const { cases, loading: casesLoading, error: casesError } = useCases();
  const { files, loading: evidenceLoading, error: evidenceError } = useAllEvidence();
  const activeCases = cases.filter((c) => c.balance > 0);

  useEffect(() => {
    if (casesLoading) return;
    let cancelled = false;
    void Promise.all(activeCases.map(async (c) => {
      const [docsResult, referralsResult] = await Promise.all([
        getLegalDocsByCaseClient(c.id),
        getReferralsByCaseClient(c.id),
      ]);
      if (docsResult.error || referralsResult.error) {
        throw new Error(docsResult.error ?? referralsResult.error ?? "Unable to load documents");
      }
      return { caseId: c.id, docs: docsResult.data ?? [], referrals: referralsResult.data ?? [] };
    })).then((results) => {
      if (cancelled) return;
      setDocumentsError(null);
      setDocsByCaseId(Object.fromEntries(results.map((r) => [r.caseId, r.docs])));
      setReferralsByCaseId(Object.fromEntries(results.map((r) => [r.caseId, r.referrals])));
    }).catch((error: unknown) => {
      if (!cancelled) setDocumentsError(error instanceof Error ? error.message : "Unable to load documents");
    }).finally(() => {
      if (!cancelled) setDocumentsLoading(false);
    });
    return () => { cancelled = true; };
  }, [cases, casesLoading]);

  return (
    <div className="flex flex-col pb-6">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-4">
        <h1 className="text-lg font-bold text-[#0D1B3D]">Documents & External Review</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Factual records, payment notices, evidence exports, and external-review preparation.
        </p>
      </div>

      <div className="px-4 pt-5 flex flex-col gap-5">
        {/* Help tip */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex gap-3">
          <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-blue-800">About notices and case preparation</p>
            <p className="text-[11px] text-blue-700 mt-0.5 leading-relaxed">
              Upload invoices and proof, prepare creditor payment notices, and export factual
              case evidence for external review. CollectBoss does not provide legal advice,
              determine court eligibility, or issue documents with lawyer or court authority.
            </p>
          </div>
        </div>

        {casesLoading || evidenceLoading || documentsLoading ? (
          <LoadingSpinner />
        ) : casesError || evidenceError || documentsError ? (
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-xs text-red-700">
            {casesError ?? evidenceError ?? documentsError}
          </div>
        ) : activeCases.length === 0 ? (
          <div className="rounded-xl border border-gray-100 bg-white px-4 py-8 text-center text-sm text-gray-400">
            No active cases yet. Add a case to prepare documents.
          </div>
        ) : (
        <div className="flex flex-col gap-3">
          {activeCases.map((c) => {
            const uploads = files.filter((file) => file.case_id === c.id);
            const uploadedIds = new Set(uploads.map((u) => u.evidence_type));
            const pct        = Math.round((uploadedIds.size / evidenceTypes.length) * 100);
            const allDocs      = docsByCaseId[c.id] ?? [];
            const packs        = allDocs.filter((d) => d.document_type === "evidence_pack");
            const demands      = allDocs.filter((d) => DEMAND_DOC_TYPES.has(d.document_type));
            const scPacks      = allDocs.filter((d) => d.document_type === "small_claim_pack");
            const latestSC     = scPacks[0] ?? null;
            const referrals    = referralsByCaseId[c.id] ?? [];
            const latestRef    = referrals[0] ?? null;

            let scMeta: { readiness_pct?: number; readiness_status?: string } = {};
            if (latestSC) { try { scMeta = JSON.parse(latestSC.content); } catch { /* ignore */ } }

            return (
              <div key={c.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {/* Case header */}
                <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-[#0D1B3D] flex items-center justify-center text-white text-xs font-bold shrink-0">
                      {c.debtor_name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-gray-900 truncate">{c.debtor_name}</p>
                      <p className="text-[11px] text-gray-400">{c.id} · {formatRM(c.balance)}</p>
                    </div>
                  </div>
                  <span className={cn(
                    "text-xs font-black shrink-0",
                    pct >= 60 ? "text-emerald-600" : pct >= 30 ? "text-amber-500" : "text-red-400"
                  )}>
                    {pct}%
                  </span>
                </div>

                {/* Action links */}
                <div className="flex flex-col divide-y divide-gray-50">
                  {[
                    {
                      href:   `/evidence/${c.id}`,
                      icon:   <Upload className="w-3.5 h-3.5" />,
                      label:  "Evidence Upload",
                      sub:    `${uploads.length} file${uploads.length !== 1 ? "s" : ""} uploaded`,
                      accent: false,
                    },
                    {
                      href:   `/evidence/${c.id}/checklist`,
                      icon:   <ShieldCheck className="w-3.5 h-3.5" />,
                      label:  "Evidence Checklist",
                      sub:    `${pct}% complete`,
                      accent: false,
                    },
                    {
                      href:   `/evidence/${c.id}/pack`,
                      icon:   <FileText className="w-3.5 h-3.5" />,
                      label:  "Case Evidence Export",
                      sub:    packs.length > 0 ? `${packs.length} PDF exported` : "Preview & export PDF",
                      accent: packs.length > 0,
                    },
                    {
                      href:   `/legal/${c.id}/demand`,
                      icon:   <FileText className="w-3.5 h-3.5" />,
                      label:  "Formal Payment Reminder",
                      sub:    demands.length > 0 ? `${demands.length} notice draft${demands.length > 1 ? "s" : ""} saved` : "Create payment notice",
                      accent: demands.length > 0,
                    },
                    {
                      href:   `/legal/${c.id}/smallclaim`,
                      icon:   <FileText className="w-3.5 h-3.5" />,
                       label:  "Small Claim Readiness",
                      sub:    latestSC
                        ? `${scMeta.readiness_pct ?? "?"}% ready · ${SMALL_CLAIM_STATUS_CONFIG[scMeta.readiness_status as keyof typeof SMALL_CLAIM_STATUS_CONFIG]?.label ?? ""}`
                         : "Prepare factual pack for external legal review",
                      accent: !!latestSC,
                    },
                    {
                      href:   `/legal/${c.id}/lawyer`,
                      icon:   <Gavel className="w-3.5 h-3.5" />,
                      label:  "Professional Legal Handoff",
                      sub:    latestRef
                        ? `${REFERRAL_STATUS_CONFIG[latestRef.referral_status]?.label ?? latestRef.referral_status}`
                        : "Request external legal review",
                      accent: !!latestRef,
                    },
                  ].map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
                    >
                      <div className={cn(
                        "w-7 h-7 rounded-lg flex items-center justify-center shrink-0",
                        item.accent ? "bg-[#0D1B3D] text-white" : "bg-emerald-50 text-[#009966]"
                      )}>
                        {item.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-gray-800">{item.label}</p>
                        <p className={cn(
                          "text-[11px]",
                          item.accent ? "text-[#009966] font-semibold" : "text-gray-400"
                        )}>
                          {item.sub}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
                    </Link>
                  ))}
                </div>

                {/* Saved demand drafts */}
                {demands.length > 0 && (
                  <div className="px-4 py-3 border-t border-gray-50 bg-[#F2F4F7]">
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-2">
                      Saved Payment Notice Drafts
                    </p>
                    {demands.slice(0, 2).map((d) => {
                      let meta: { generated_at?: string; deadline_days?: number } = {};
                      try { meta = JSON.parse(d.content); } catch { /* ignore */ }
                      return (
                        <div key={d.id} className="flex items-center gap-2.5 mb-1.5 last:mb-0">
                          <FileText className="w-3.5 h-3.5 text-[#009966] shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-semibold text-gray-700 truncate">
                              {TONE_LABELS[d.document_type] ?? d.document_type}
                            </p>
                            <p className="text-[10px] text-gray-400">
                              {meta.generated_at
                                ? new Date(meta.generated_at).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })
                                : new Date(d.created_at).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}
                              {meta.deadline_days ? ` · ${meta.deadline_days}-day deadline` : ""}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                    {demands.length > 2 && (
                      <Link href={`/legal/${c.id}/demand`} className="text-[10px] text-[#009966] font-semibold">
                        +{demands.length - 2} more →
                      </Link>
                    )}
                  </div>
                )}

                {/* Small claim status */}
                {latestSC && (
                  <div className="px-4 py-3 border-t border-gray-50 bg-blue-50">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FileText className="w-3.5 h-3.5 text-blue-600" />
                         <p className="text-[11px] font-bold text-gray-700">Case Evidence Export</p>
                      </div>
                      {(() => {
                        const cfg = scMeta.readiness_status
                          ? SMALL_CLAIM_STATUS_CONFIG[scMeta.readiness_status as keyof typeof SMALL_CLAIM_STATUS_CONFIG]
                          : null;
                        return cfg ? (
                          <span className={cn(
                            "text-[10px] font-bold px-2 py-0.5 rounded-full border",
                            cfg.color, cfg.bg, cfg.border
                          )}>
                            {cfg.label}
                          </span>
                        ) : null;
                      })()}
                    </div>
                  </div>
                )}

                {/* Referral status */}
                {latestRef && (
                  <div className="px-4 py-3 border-t border-gray-50 bg-emerald-50">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Send className="w-3.5 h-3.5 text-[#009966]" />
                        <p className="text-[11px] font-bold text-gray-700">
                          Legal handoff: {latestRef.partner_name ?? "External professional not assigned"}
                        </p>
                      </div>
                      {(() => {
                        const cfg = REFERRAL_STATUS_CONFIG[latestRef.referral_status];
                        return cfg ? (
                          <span className={cn(
                            "text-[10px] font-bold px-2 py-0.5 rounded-full border",
                            cfg.color, cfg.bg, cfg.border
                          )}>
                            {cfg.label}
                          </span>
                        ) : null;
                      })()}
                    </div>
                  </div>
                )}

                {/* Evidence packs */}
                {packs.length > 0 && (
                  <div className="px-4 py-3 border-t border-gray-50 bg-[#F2F4F7]">
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-2">
                      Exported Evidence Packs
                    </p>
                    {packs.slice(0, 1).map((pack) => {
                      let meta: { generated_at?: string; evidence_score?: number } = {};
                      try { meta = JSON.parse(pack.content); } catch { /* ignore */ }
                      return (
                        <div key={pack.id} className="flex items-center gap-2.5">
                          <Download className="w-3.5 h-3.5 text-[#009966] shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-semibold text-gray-700 truncate">{pack.title}</p>
                            <p className="text-[10px] text-gray-400">
                              {meta.generated_at
                                ? new Date(meta.generated_at).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })
                                : new Date(pack.created_at).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}
                              {meta.evidence_score != null ? ` · ${meta.evidence_score}% complete` : ""}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        )}

        {/* Referral status section — shown inline per case, handled above */}

        {/* Disclaimer */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <p className="text-[11px] text-amber-800 leading-relaxed">
            <strong>CollectBoss helps prepare document drafts based on your case records.
            This is not legal advice.</strong> Please consult a qualified lawyer before taking legal action.
          </p>
        </div>
      </div>
    </div>
  );
}
