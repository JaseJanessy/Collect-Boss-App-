"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { SectionCard } from "@/components/ui/section-card";
import { PrimaryButton } from "@/components/ui/primary-button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { evidenceTypes, type EvidenceType } from "@/lib/mock-legal-data";
import { type EvidenceFileRow, type EvidenceType as DbEvidenceType } from "@/lib/supabase/types";
import { useEvidence } from "@/hooks/use-evidence";
import {
  ChevronLeft,
  CheckCircle2,
  Circle,
  Upload,
  ArrowRight,
  Lightbulb,
  AlertCircle,
  ShieldCheck,
} from "lucide-react";

// ─── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  caseId: string;
}

// ─── Main component ────────────────────────────────────────────────────────────

export function EvidenceChecklistPage({ caseId }: Props) {
  const { files, loading, error } = useEvidence(caseId);

  const uploadedTypes = new Set(files.map((f) => f.evidence_type));

  const mustHave   = evidenceTypes.filter((e) => e.category === "must_have");
  const goodToHave = evidenceTypes.filter((e) => e.category === "good_to_have");

  const mustDone  = mustHave.filter((e) => uploadedTypes.has(e.id as DbEvidenceType)).length;
  const goodDone  = goodToHave.filter((e) => uploadedTypes.has(e.id as DbEvidenceType)).length;
  const totalDone = mustDone + goodDone;
  const total     = evidenceTypes.length;
  const pct       = total > 0 ? Math.round((totalDone / total) * 100) : 0;
  const allMustHave = mustDone === mustHave.length;

  // Map evidence_type → files for display
  const filesByType = files.reduce<Record<string, EvidenceFileRow[]>>((acc, f) => {
    if (!acc[f.evidence_type]) acc[f.evidence_type] = [];
    acc[f.evidence_type].push(f);
    return acc;
  }, {});

  // Next recommended action
  const nextAction = !uploadedTypes.has("invoice")
    ? "Upload your invoice or written proof of the debt amount."
    : !uploadedTypes.has("whatsapp")
    ? "Add a WhatsApp / chat screenshot showing the debtor acknowledged the debt."
    : !uploadedTypes.has("payment_proof")
    ? "Upload any partial payment proof or payment deadline confirmation."
    : !uploadedTypes.has("contract")
    ? "Add a contract or purchase agreement if you have one."
    : "Your factual record set is strong. Consider preparing a Formal Payment Reminder.";

  return (
    <div className="flex flex-col pb-6">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center gap-2 mb-1">
          <Link href={`/evidence/${caseId}`} className="text-gray-400 hover:text-gray-600">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-lg font-bold text-[#0D1B3D]">Evidence Checklist</h1>
        </div>
        <p className="text-xs text-gray-400 ml-7">
          Track what you have and what you still need.
        </p>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : error ? (
        <div className="mx-4 mt-5 flex items-start gap-3 bg-red-50 border border-red-100 rounded-xl p-4">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-xs text-red-700">{error}</p>
        </div>
      ) : (
        <div className="px-4 pt-5 flex flex-col gap-5">
          {/* Summary hero */}
          <div className="bg-[#0D1B3D] rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-blue-200 text-xs font-medium">Evidence Completeness</p>
                <p className="text-[11px] text-blue-300">
                  {mustDone}/{mustHave.length} must-have · {totalDone}/{total} total
                </p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-black text-white">{pct}%</p>
              </div>
            </div>
            <div className="w-full bg-white/20 rounded-full h-2">
              <div
                className="bg-[#009966] h-2 rounded-full transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex items-center gap-1.5 mt-2">
              {allMustHave ? (
                <>
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <p className="text-xs text-emerald-300 font-semibold">
                    All must-have documents ready
                  </p>
                </>
              ) : (
                <>
                  <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                  <p className="text-xs text-amber-300 font-semibold">
                    {mustHave.length - mustDone} must-have document
                    {mustHave.length - mustDone > 1 ? "s" : ""} missing
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Next recommended action */}
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex gap-2">
            <ArrowRight className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-emerald-800">Recommended Next Step</p>
              <p className="text-[11px] text-emerald-700 mt-0.5 leading-relaxed">{nextAction}</p>
            </div>
          </div>

          {/* Must Have group */}
          <ChecklistGroup
            title="Must Have"
            subtitle="Required for debt recovery action"
            emoji="⚡"
            items={mustHave}
            uploadedTypes={uploadedTypes}
            filesByType={filesByType}
            caseId={caseId}
            accentColor="emerald"
          />

          {/* Good to Have group */}
          <ChecklistGroup
            title="Good to Have"
            subtitle="These strengthen your position"
            emoji="✨"
            items={goodToHave}
            uploadedTypes={uploadedTypes}
            filesByType={filesByType}
            caseId={caseId}
            accentColor="blue"
          />

          {/* Missing items summary */}
          {totalDone < total && (
            <SectionCard title="Missing Documents">
              <div className="flex flex-col gap-2 mt-1">
                {evidenceTypes
                  .filter((e) => !uploadedTypes.has(e.id as DbEvidenceType))
                  .map((e) => (
                    <div key={e.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{e.icon}</span>
                        <div>
                          <p className="text-xs font-semibold text-gray-700">{e.name}</p>
                          <p className="text-[10px] text-gray-400">
                            {e.category === "must_have" ? "Must Have" : "Good to Have"}
                          </p>
                        </div>
                      </div>
                      <Link
                        href={`/evidence/${caseId}`}
                        className="flex items-center gap-1 text-[11px] font-bold text-[#009966] bg-emerald-50 border border-emerald-200 px-2 py-1.5 rounded-lg hover:bg-emerald-100 transition-colors"
                      >
                        <Upload className="w-3 h-3" /> Upload
                      </Link>
                    </div>
                  ))}
              </div>
            </SectionCard>
          )}

          {/* Malaysian SME tips */}
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Lightbulb className="w-4 h-4 text-amber-600" />
              <p className="text-sm font-bold text-amber-800">Tips for Malaysian Business Owners</p>
            </div>
            <div className="flex flex-col gap-2.5">
              {[
                { emoji: "📱", tip: "WhatsApp chats are accepted as evidence in Malaysian courts — take clear screenshots with the date visible." },
                { emoji: "📦", tip: "If your customer signed a delivery order, this is very strong proof they received what you supplied." },
                { emoji: "🏦", tip: "Save all DuitNow and bank transfer references — these prove partial payments were made." },
                { emoji: "⏰", tip: "The more detailed your timeline, the easier it is for a lawyer or court to understand your case." },
              ].map(({ emoji, tip }) => (
                <div key={tip} className="flex items-start gap-2">
                  <span className="text-base shrink-0">{emoji}</span>
                  <p className="text-xs text-amber-700 leading-relaxed">{tip}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Disclaimer */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
            <p className="text-[11px] text-gray-500 leading-relaxed">
              <strong>CollectBoss does not provide legal advice.</strong> This checklist
              is a guide to help you organise your documents. Consult a qualified
              lawyer before taking legal action.
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2">
            <Link href={`/evidence/${caseId}/pack`}>
              <PrimaryButton fullWidth size="lg" icon={<ArrowRight className="w-4 h-4" />}>
                Preview Evidence Pack
              </PrimaryButton>
            </Link>
            <Link href={`/evidence/${caseId}`}>
              <PrimaryButton fullWidth variant="ghost" size="md" icon={<Upload className="w-4 h-4" />}>
                Upload More Documents
              </PrimaryButton>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Checklist group ──────────────────────────────────────────────────────────

function ChecklistGroup({
  title,
  subtitle,
  emoji,
  items,
  uploadedTypes,
  filesByType,
  caseId,
  accentColor,
}: {
  title:        string;
  subtitle:     string;
  emoji:        string;
  items:        EvidenceType[];
  uploadedTypes: Set<string>;
  filesByType:  Record<string, EvidenceFileRow[]>;
  caseId:       string;
  accentColor:  "emerald" | "blue";
}) {
  const done = items.filter((i) => uploadedTypes.has(i.id)).length;
  const accent = accentColor === "emerald"
    ? { bg: "bg-emerald-50", border: "border-emerald-200", count: "text-emerald-600" }
    : { bg: "bg-blue-50", border: "border-blue-200", count: "text-blue-600" };

  return (
    <SectionCard>
      <div className="flex items-center justify-between mb-3 pt-1">
        <div className="flex items-center gap-2">
          <span className="text-base">{emoji}</span>
          <div>
            <p className="text-sm font-bold text-gray-900">{title}</p>
            <p className="text-[11px] text-gray-400">{subtitle}</p>
          </div>
        </div>
        <span className={cn("text-xs font-black", accent.count)}>
          {done}/{items.length}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {items.map((item) => {
          const isUploaded = uploadedTypes.has(item.id);
          const typeFiles  = filesByType[item.id] ?? [];

          return (
            <div
              key={item.id}
              className={cn(
                "flex items-start gap-3 p-3 rounded-xl border transition-all",
                isUploaded
                  ? `${accent.bg} ${accent.border}`
                  : "bg-white border-gray-100"
              )}
            >
              <div className="shrink-0 mt-0.5">
                {isUploaded
                  ? <CheckCircle2 className={cn("w-5 h-5", accent.count)} />
                  : <Circle className="w-5 h-5 text-gray-300" />
                }
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-base">{item.icon}</span>
                  <p className="text-sm font-bold text-gray-900">{item.name}</p>
                </div>
                <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">
                  {item.description}
                </p>
                {isUploaded && typeFiles.length > 0 && (
                  <div className="flex flex-col gap-0.5 mt-1">
                    {typeFiles.map((f) => (
                      <p key={f.id} className={cn("text-[11px] font-semibold", accent.count)}>
                        ✓ {f.file_name}
                      </p>
                    ))}
                  </div>
                )}
              </div>

              {!isUploaded && (
                <Link
                  href={`/evidence/${caseId}`}
                  className="shrink-0 flex items-center gap-1 text-[11px] font-bold text-[#009966] bg-emerald-50 border border-emerald-200 px-2 py-1.5 rounded-lg hover:bg-emerald-100 transition-colors"
                >
                  <Upload className="w-3 h-3" /> Add
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
