"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/status-badge";
import { SectionCard } from "@/components/ui/section-card";
import { PrimaryButton } from "@/components/ui/primary-button";
import { LoadingSpinner, InlineSpinner } from "@/components/ui/loading-spinner";
import {
  type CaseRow, type CustomerAccountRow, type LegalDocumentRow,
  type LawyerReferralRow, type ObligationRow,
} from "@/lib/supabase/types";
import {
  STATUS_LABELS,
  caseStatusSchema,
  type CaseStatusValue,
  recordPaymentAmountSchema,
} from "@/lib/validations/case";
import { canTransitionCase } from "@/lib/domain/workflows";
import { getInitials, getAvatarColor } from "@/lib/mock-data";
import { useCase } from "@/hooks/use-case";
import { useCasePrioritySummary } from "@/hooks/use-case-priority-summary";
import type { CasePrioritySummary } from "@/lib/cases/priority-summary";
import { useEvidence } from "@/hooks/use-evidence";
import { getRequestsByCaseClient } from "@/lib/db/payment-access-client";
import { usePayments } from "@/hooks/use-payments";
import { PAYMENT_METHOD_LABELS, REVIEW_STATUS_CONFIG } from "@/lib/db/payments-client";
import {
  REMINDER_TYPES,
  REMINDER_STATUS_LABELS,
  REMINDER_STATUS_COLORS,
} from "@/lib/reminders/generator";
import {
  updateCaseStatusClient,
  updateNextActionClient,
  recordPaymentClient,
  updateCaseLockModeClient,
} from "@/lib/db/cases-client";
import { appendAuditLogClient } from "@/lib/db/audit-logs-client";
import { useBusinessId } from "@/hooks/use-business-id";
import { usePaymentPlans } from "@/hooks/use-payment-plans";
import { usePaymentPromises } from "@/hooks/use-payment-promises";
import { PaymentPromiseCard } from "@/components/cases/payment-promise-card";
import { useCommunicationActivities } from "@/hooks/use-communication-activities";
import { CommunicationActivityPanel } from "@/components/cases/communication-activity";
import { useDisputes } from "@/hooks/use-disputes";
import { DisputeCard } from "@/components/cases/dispute-card";
import { useCaseTimeline } from "@/hooks/use-case-timeline";
import { UnifiedCaseTimeline } from "@/components/cases/unified-case-timeline";
// R12 folds the legacy CommunicationTimeline, PaymentPromiseTimeline and
// DisputeTimeline projections into UnifiedCaseTimeline without deleting their
// source components or records.
import { useFinancialAdjustments } from "@/hooks/use-financial-adjustments";
import { FinancialAdjustmentsCard } from "@/components/cases/financial-adjustments-card";
import { useDebtTruth } from "@/hooks/use-debt-truth";
import { DebtTruthCard } from "@/components/cases/debt-truth-card";
import { useDiscrepancies } from "@/hooks/use-discrepancies";
import { DiscrepancyCard } from "@/components/cases/discrepancy-card";
import { type PaymentPlanDetails } from "@/lib/db/payment-plans-client";
import { useRegion } from "@/contexts/region-context";
import { formatCalendarDate, formatCurrency, formatDateTime, formatMinorCurrency } from "@/lib/international/formatting";
import { getCurrencyMetadata } from "@/lib/financial/money";
import { useLegalDocuments } from "@/hooks/use-legal-documents";
import { useLawyerReferrals } from "@/hooks/use-lawyer-referrals";
import { REFERRAL_STATUS_CONFIG } from "@/lib/lawyer-referrals/status";
import { SMALL_CLAIM_STATUS_CONFIG } from "@/components/pages/legal/small-claim-page";
import { evidenceTypes } from "@/lib/mock-legal-data";
import { type EvidenceType as DbEvidenceType } from "@/lib/supabase/types";
import { useAuth } from "@/hooks/use-auth";
import {
  canAccessCaseWorkspaceSection,
  caseWorkspaceHref,
  caseWorkspaceSections,
  resolveCaseWorkspaceSection,
  type CaseWorkspaceSectionId,
} from "@/lib/cases/workspace";
import {
  ChevronLeft,
  ChevronRight,
  Phone,
  Mail,
  MapPin,
  Calendar,
  FileText,
  Send,
  CheckCircle2,
  Clock,
  MessageCircle,
  DollarSign,
  AlertCircle,
  Edit3,
  X,
  Check,
  ChevronDown,
  Banknote,
  Upload,
  ShieldCheck,
  Lock,
  Eye,
  ClipboardList,
  ExternalLink,
  Download,
} from "lucide-react";

// ─── Props ─────────────────────────────────────────────────────────────────────

interface CaseDetailPageProps {
  caseId: string;
}

// ─── Main component ────────────────────────────────────────────────────────────

export function CaseDetailPage({ caseId }: CaseDetailPageProps) {
  const { configuration } = useRegion();
  const { permissions, accessLoading, hasPermission } = useAuth();
  const searchParams = useSearchParams();
  const justCreated = searchParams?.get("created") === "1";
  const activeSection = resolveCaseWorkspaceSection(
    searchParams?.get("section"),
    searchParams?.get("tab"),
  );
  const [visitedSections, setVisitedSections] = useState<Set<CaseWorkspaceSectionId>>(
    () => new Set([activeSection]),
  );
  const hasSectionAccess = (sectionId: CaseWorkspaceSectionId) => {
    const section = caseWorkspaceSections.find((item) => item.id === sectionId);
    return Boolean(section && canAccessCaseWorkspaceSection(section, permissions));
  };
  const sectionEnabled = (sectionId: CaseWorkspaceSectionId) =>
    visitedSections.has(sectionId) && hasSectionAccess(sectionId);
  const openSection = (sectionId: CaseWorkspaceSectionId) => {
    setVisitedSections((current) => new Set(current).add(sectionId));
    window.history.pushState(null, "", caseWorkspaceHref(caseId, sectionId));
  };

  const { caseData, loading, error, update, refresh: refreshCase } = useCase(caseId);
  const casePriority = useCasePrioritySummary(caseId);
  const financialsEnabled = sectionEnabled("financials");
  const communicationsEnabled = sectionEnabled("communications");
  const resolutionEnabled = sectionEnabled("resolution");
  const evidenceEnabled = sectionEnabled("evidence");
  const legalEnabled = sectionEnabled("legal");
  const activityEnabled = sectionEnabled("activity");
  const receivablesEnabled = visitedSections.has("overview") || financialsEnabled || resolutionEnabled;
  const { files: evidenceFiles } = useEvidence(caseId, evidenceEnabled);
  const { payments, approve: approvePayment, refresh: refreshPayments } = usePayments(caseId, financialsEnabled);
  const { activePlan, plans: allPlans } = usePaymentPlans(caseId, resolutionEnabled);
  const paymentPromises = usePaymentPromises(caseId, resolutionEnabled);
  const communications = useCommunicationActivities(caseId, communicationsEnabled);
  const disputes = useDisputes(caseId, resolutionEnabled);
  const timeline = useCaseTimeline(caseId, activityEnabled);
  const financialAdjustments = useFinancialAdjustments(caseId, financialsEnabled);
  const debtTruth = useDebtTruth(caseId, financialsEnabled);
  const discrepancies = useDiscrepancies(caseId, financialsEnabled);
  const { docs: legalDocs } = useLegalDocuments(caseId, evidenceEnabled || legalEnabled);
  const { latest: latestReferral } = useLawyerReferrals(caseId, legalEnabled);
  const businessId = useBusinessId();
  const [receivableContext, setReceivableContext] = useState<{
    account: CustomerAccountRow | null;
    obligations: ObligationRow[];
  } | null>(null);
  useEffect(() => {
    if (!receivablesEnabled) return;
    let active = true;
    fetch(`/api/cases/${caseId}/receivables`, { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ account: CustomerAccountRow | null; obligations: ObligationRow[] }> : null)
      .then((result) => { if (active && result) setReceivableContext(result); })
      .catch(() => { /* The additive migration may not be deployed yet. */ });
    return () => { active = false; };
  }, [caseId, receivablesEnabled]);
  const [pendingCount, setPendingCount] = useState(0);
  useEffect(() => {
    if (!financialsEnabled) return;
    getRequestsByCaseClient(caseId).then((r) => {
      if (r.data) setPendingCount(r.data.filter((x) => x.status === "pending").length);
    });
  }, [caseId, financialsEnabled]);

  const [showCreatedBanner, setShowCreatedBanner] = useState(justCreated);
  useEffect(() => {
    if (justCreated) {
      const t = setTimeout(() => setShowCreatedBanner(false), 4000);
      return () => clearTimeout(t);
    }
  }, [justCreated]);

  if (loading) return <LoadingSpinner />;

  if (error || !caseData) {
    return (
      <div className="px-4 py-16 flex flex-col items-center gap-4">
        <AlertCircle className="w-8 h-8 text-red-400" />
        <p className="text-sm font-semibold text-gray-700">
          {error ?? "Case not found"}
        </p>
        <Link href="/cases" className="text-sm text-[#009966] font-semibold">
          ← Back to Cases
        </Link>
      </div>
    );
  }

  const c = caseData;
  const caseCurrency = c.currency ?? configuration.settings.defaultCurrency;
  const money = (amount: number) => formatCurrency(amount, configuration.settings, caseCurrency);
  const calendarDate = (value: string) => formatCalendarDate(value, configuration.settings);
  const stateAction = c.status === "paid"
    ? { label: "View Financials", section: "financials" as const, icon: <Banknote className="w-4 h-4" /> }
    : c.status === "closed"
      ? { label: "View Legal", section: "legal" as const, icon: <FileText className="w-4 h-4" /> }
      : c.status === "payment_promise"
    ? { label: "Review Resolution", section: "resolution" as const, icon: <ClipboardList className="w-4 h-4" /> }
    : c.status === "formal_demand_ready"
      ? { label: "Prepare Handoff", section: "legal" as const, icon: <ShieldCheck className="w-4 h-4" /> }
      : { label: "Follow Up", section: "communications" as const, icon: <Send className="w-4 h-4" /> };
  const primaryCaseAction = hasSectionAccess(stateAction.section)
    ? stateAction
    : { label: "View Activity", section: "activity" as const, icon: <Clock className="w-4 h-4" /> };
  const visibleSections = caseWorkspaceSections.filter((section) =>
    canAccessCaseWorkspaceSection(section, permissions),
  );
  const activeSectionAllowed = hasSectionAccess(activeSection);
  const fallbackRiskFlags = [
    c.days_overdue >= 90 ? "90+ days overdue" : c.days_overdue >= 30 ? "30+ days overdue" : null,
    c.priority === "urgent" || c.priority === "high" ? `${c.priority} priority` : null,
    c.status === "payment_promise" ? "Promise active" : null,
  ].filter((flag): flag is string => Boolean(flag));
  const riskFlags = casePriority.summary?.riskFlags ?? fallbackRiskFlags;
  const balanceStatus = casePriority.summary?.balanceVerification === "ledger_verified" || c.financial_version > 0
    ? "Ledger verified"
    : "Legacy balance · verify records";
  const caseOwner = c.assigned_to ? "Assigned team member" : "Business owner";
  const summaryAction = casePriority.summary?.nextAction;
  const summaryActionAllowed = !summaryAction
    || ((!summaryAction.href.includes("section=resolution") || hasSectionAccess("resolution"))
      && (!summaryAction.href.startsWith("/payments") || hasPermission("payment.approve"))
      && (!summaryAction.href.startsWith("/evidence") || hasPermission("case.manage")));
  const nextAction = summaryAction && summaryActionAllowed
    ? summaryAction
    : { label: c.next_best_action?.trim() || primaryCaseAction.label, href: caseWorkspaceHref(c.id, primaryCaseAction.section) };

  return (
    <div className="cb-analytics-light flex flex-col bg-[#F6F8FC] pb-24 text-slate-900">
      {/* Success banner (after creation) */}
      {showCreatedBanner && (
        <div className="mx-4 mt-3 flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <p className="text-xs font-semibold text-emerald-700 flex-1">
            Case created successfully!
          </p>
          <button onClick={() => setShowCreatedBanner(false)} className="text-emerald-500 hover:text-emerald-700">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Sticky top bar */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
        <Link
          href="/cases"
          className="flex items-center gap-1 text-sm font-semibold text-[#0D1B3D]"
        >
          <ChevronLeft className="w-5 h-5" />
          Back to Cases
        </Link>
        {hasPermission("case.manage") ? (
          <StatusSelector
            caseId={c.id}
            caseData={c}
            onUpdate={(updated) => update(updated)}
          />
        ) : <StatusBadge status={c.status} />}
      </div>

      {/* Hero: Debtor summary */}
      <div className="bg-white px-4 pb-5 pt-4 border-b border-gray-100">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "w-12 h-12 rounded-2xl flex items-center justify-center text-white text-base font-bold shrink-0",
              getAvatarColor(c.debtor_name)
            )}
          >
            {getInitials(c.debtor_name)}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h1 className="break-words text-base font-black leading-tight text-[#0D1B3D]">
                  {c.debtor_name}
                </h1>
                {c.debtor_reg_no && (
                  <p className="text-[11px] text-gray-400 mt-0.5">Reg: {c.debtor_reg_no}</p>
                )}
              </div>
              <StatusBadge status={c.status} />
            </div>

            <div className="flex flex-col gap-1 mt-2">
              {c.debtor_location && (
                <div className="flex min-w-0 items-start gap-1.5 text-xs text-gray-500">
                  <MapPin className="w-3 h-3 shrink-0 text-gray-400" />
                  <span className="min-w-0 break-words">{c.debtor_location}</span>
                </div>
              )}
              {c.debtor_phone && (
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <Phone className="w-3 h-3 shrink-0 text-gray-400" />
                  {c.debtor_phone}
                </div>
              )}
              {c.debtor_email && (
                <div className="flex min-w-0 items-start gap-1.5 text-xs text-gray-500">
                  <Mail className="w-3 h-3 shrink-0 text-gray-400" />
                  <span className="min-w-0 break-all">{c.debtor_email}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Key chips */}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <AmountChip
            label="Due Date"
            value={calendarDate(c.due_date)}
            sub={c.days_overdue > 0 ? `${c.days_overdue} days overdue` : undefined}
            subColor="text-red-500"
            icon={<Calendar className="w-3.5 h-3.5" />}
          />
          <AmountChip
            label="Invoice No."
            value={c.invoice_no ?? "—"}
            icon={<FileText className="w-3.5 h-3.5" />}
          />
          <AmountChip
            label="Bank"
            value={c.bank ?? "—"}
            icon={<DollarSign className="w-3.5 h-3.5" />}
          />
        </div>
      </div>

      {/* Money-first mobile case summary */}
      <div
        className={cn(
          "mx-4 mt-4 rounded-2xl border p-4 shadow-sm",
          c.status === "paid"
            ? "bg-emerald-50 border border-emerald-100"
            : "border-blue-200 bg-white"
        )}
      >
        <p className={cn("text-xs font-semibold mb-1", c.status === "paid" ? "text-emerald-700" : "text-blue-700")}>
          {c.status === "paid" ? "Amount Paid" : "Outstanding"}
        </p>
        <p className={cn("text-3xl font-black tracking-tight", c.status === "paid" ? "text-emerald-700" : "text-[#0D1B3D]")}>
          {money(c.status === "paid" ? c.amount_paid : c.balance)}
        </p>

        {c.amount_owed > 0 && (
          <div className="mt-3">
            <div className="flex justify-between text-[11px] mb-1.5">
              <span className="text-slate-600">Paid: {money(c.amount_paid)}</span>
              <span className="text-slate-600">Remaining: {money(c.balance)}</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2">
              <div
                className="bg-emerald-600 h-2 rounded-full transition-all"
                style={{ width: `${Math.min(100, Math.round((c.amount_paid / c.amount_owed) * 100))}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5">
              {Math.min(100, Math.round((c.amount_paid / c.amount_owed) * 100))}% paid
            </p>
          </div>
        )}

        {c.days_overdue > 0 && c.status !== "paid" && (
          <div className="flex items-center gap-1.5 mt-2">
            <AlertCircle className="w-3.5 h-3.5 text-red-400" />
            <p className="text-xs text-red-700 font-semibold">
              {c.days_overdue} days overdue
            </p>
          </div>
        )}

        <div className="mt-3 rounded-xl bg-slate-50 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Next action</p>
          <Link href={nextAction.href} className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-emerald-700 hover:text-emerald-800">
            {nextAction.label}<ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <CasePrioritySnapshot
          summary={casePriority.summary}
          loading={casePriority.loading}
          error={casePriority.error}
          currency={caseCurrency}
          moneyMinor={(minor, currency) => formatMinorCurrency(minor, configuration.settings, currency)}
          dateTime={(value) => formatDateTime(value, configuration.settings, { dateStyle: "medium", timeStyle: "short" })}
          calendarDate={calendarDate}
        />

        <dl className="mt-2 grid gap-2 sm:grid-cols-3" aria-label="Persistent case summary">
          <div className="rounded-xl border border-slate-100 bg-white p-2.5">
            <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Balance status</dt>
            <dd className="mt-1 text-xs font-bold text-slate-700">{balanceStatus}</dd>
          </div>
          <div className="rounded-xl border border-slate-100 bg-white p-2.5" title={c.assigned_to ?? undefined}>
            <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Case owner</dt>
            <dd className="mt-1 text-xs font-bold text-slate-700">{caseOwner}</dd>
          </div>
          <div className="rounded-xl border border-slate-100 bg-white p-2.5">
            <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Risk flags</dt>
            <dd className="mt-1 text-xs font-bold text-slate-700">{riskFlags.length ? riskFlags.join(" · ") : "No current flags"}</dd>
          </div>
        </dl>
      </div>

      <div className="px-4 mt-4">
        <div className="flex flex-wrap items-center gap-2" aria-label="Case actions">
          <button type="button" onClick={() => openSection(primaryCaseAction.section)} className="inline-flex items-center gap-2 rounded-xl bg-[#009966] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#00B377]">
            {primaryCaseAction.icon}
            {primaryCaseAction.label}
          </button>
          {hasSectionAccess("financials") && c.status !== "paid" && c.status !== "closed" && (
            <button type="button" onClick={() => openSection("financials")} className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs font-bold text-[#0D1B3D] hover:bg-gray-50">
              <Banknote className="w-4 h-4" /> Record Payment
            </button>
          )}
          <button type="button" onClick={() => openSection("activity")} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-[#0D1B3D] hover:bg-slate-50">
            <Clock className="w-4 h-4" /> Activity
          </button>
          <details className="relative ml-auto">
            <summary className="list-none cursor-pointer inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50">
              More Actions <ChevronDown className="w-3.5 h-3.5" />
            </summary>
            <div className="absolute right-0 z-30 mt-2 w-64 rounded-2xl border border-gray-100 bg-white p-2 shadow-xl">
              {[
                { label: "Payment Access", href: `/payments/access/${c.id}` },
                { label: activePlan ? "View Payment Plan" : "Offer Payment Plan", href: `/legal/${c.id}/plan` },
                { label: "Upload Evidence", href: `/evidence/${c.id}` },
                { label: "Prepare Payment Notice", href: `/legal/${c.id}/demand` },
                { label: "Small Claim Readiness", href: `/legal/${c.id}/smallclaim` },
                { label: "Prepare Professional Handoff", href: `/legal/${c.id}/lawyer` },
                { label: "Debt Acknowledgement", href: `/legal/${c.id}/acknowledge` },
              ].map((action) => (
                <Link key={action.href} href={action.href} className="block rounded-xl px-3 py-2.5 text-xs font-semibold text-gray-700 hover:bg-emerald-50 hover:text-[#009966]">
                  {action.label}
                </Link>
              ))}
            </div>
          </details>
        </div>

        <div className="mt-4 flex gap-1 overflow-x-auto rounded-xl bg-gray-100 p-1" role="tablist" aria-label="Case workspace sections">
          {visibleSections.map((section) => (
            <button
              key={section.id}
              type="button"
              role="tab"
              aria-selected={activeSection === section.id}
              aria-controls={`case-panel-${section.id}`}
              onClick={() => openSection(section.id)}
              className={cn(
                "min-w-max flex-1 rounded-lg px-3 py-2 text-[11px] font-bold transition-colors sm:text-xs",
                activeSection === section.id ? "bg-white text-[#0D1B3D] shadow-sm" : "text-gray-500 hover:text-gray-800",
              )}
            >
              {section.label}
            </button>
          ))}
        </div>
      </div>

      <div id={`case-panel-${activeSection}`} role="tabpanel" className="px-4 flex flex-col gap-4 mt-4">
        {!accessLoading && !activeSectionAllowed && (
          <SectionCard title="Section unavailable">
            <p className="mt-2 text-sm text-gray-600">Your role does not have permission to open this case section.</p>
          </SectionCard>
        )}
        {/* Next best action */}
        {activeSectionAllowed && activeSection === "overview" && (
          <NextActionSection
            caseId={c.id}
            nextAction={c.next_best_action}
            businessId={businessId ?? "mock-business-id"}
            canEdit={hasPermission("case.manage")}
            onUpdate={(updated) => update(updated)}
          />
        )}

        {/* Record payment */}
        {activeSectionAllowed && activeSection === "financials" && c.status !== "paid" && (
          <RecordPaymentSection
            caseId={c.id}
            businessId={businessId ?? "mock-business-id"}
            balance={c.balance}
            currency={caseCurrency}
            onUpdate={(updated) => update(updated)}
          />
        )}

        {/* Payment lock */}
        {activeSectionAllowed && activeSection === "financials" && (
          <PaymentLockSection
            caseId={c.id}
            lockMode={c.payment_lock_mode}
            businessId={businessId ?? "mock-business-id"}
            pendingCount={pendingCount}
            onUpdate={(updated) => update(updated)}
          />
        )}

        {/* Evidence completeness */}
        {activeSectionAllowed && activeSection === "evidence" && <EvidenceCompletenessSection caseId={c.id} evidenceFiles={evidenceFiles} />}

        {/* Evidence pack export */}
        {activeSectionAllowed && activeSection === "evidence" && <CaseEvidencePackSection caseId={c.id} legalDocs={legalDocs} />}

        {/* Formal demands */}
        {activeSectionAllowed && activeSection === "legal" && <CaseFormalDemandsSection caseId={c.id} legalDocs={legalDocs} />}

        {/* Lawyer referral */}
        {activeSectionAllowed && activeSection === "legal" && <CaseLawyerReferralSection
          caseId={c.id}
          latestReferral={latestReferral}
        />}

        {/* Small claim */}
        {activeSectionAllowed && activeSection === "legal" && <CaseSmallClaimSection
          caseId={c.id}
          legalDocs={legalDocs}
        />}

        {/* Overview */}
        {activeSectionAllowed && activeSection === "communications" && <CommunicationActivityPanel
          debtorName={c.debtor_name}
          caseId={c.id}
          phone={c.debtor_phone}
          email={c.debtor_email}
          activities={communications.activities}
          caseCounters={communications.case_counters}
          customerCounters={communications.customer_counters}
          preferences={communications.preferences}
          policy={communications.policy}
          guardrails={communications.guardrails}
          loading={communications.loading}
          error={communications.error}
          initiate={communications.initiate}
          recordCallOutcome={communications.recordCallOutcome}
          savePreferences={communications.savePreferences}
          savePolicy={communications.savePolicy}
          refresh={communications.refresh}
        />}

        {activeSectionAllowed && activeSection === "overview" && <SectionCard title="Account Overview">
          <div className="flex flex-col gap-2 mt-2">
            {[
              { label: "Amount Owed",  value: money(c.amount_owed) },
              { label: "Amount Paid",  value: money(c.amount_paid) },
              { label: "Balance Due",  value: money(c.balance) },
              { label: "Invoice No.",  value: c.invoice_no ?? "—" },
              { label: "Due Date",     value: calendarDate(c.due_date) },
              { label: "Days Overdue", value: c.days_overdue > 0 ? `${c.days_overdue} days` : "Not overdue" },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0"
              >
                <span className="text-xs text-gray-400">{row.label}</span>
                <span className="text-sm font-semibold text-gray-800">{row.value}</span>
              </div>
            ))}
          </div>
        </SectionCard>}

        {activeSectionAllowed && activeSection === "overview" && (receivableContext?.account || receivableContext?.obligations.length) && (
          <SectionCard title="Receivable Coverage">
            <div className="mt-2 flex flex-col gap-2">
              {receivableContext.account && (
                <div className="rounded-xl bg-[#F2F4F7] px-3 py-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Customer Account</p>
                  <p className="mt-0.5 break-words text-sm font-bold text-gray-800">{receivableContext.account.display_name}</p>
                  <p className="text-[11px] text-gray-500">{receivableContext.account.account_type.replaceAll("_", " ")}</p>
                </div>
              )}
              {receivableContext.obligations.map((obligation) => (
                <div key={obligation.id} className="flex items-center justify-between gap-3 border-b border-gray-50 py-2 last:border-0">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-gray-800">{obligation.reference}</p>
                    <p className="text-[10px] text-gray-400">Due {calendarDate(obligation.due_date)} · {obligation.status}</p>
                  </div>
                  <p className="shrink-0 text-sm font-black text-[#0D1B3D]">{formatMinorCurrency(obligation.outstanding_minor, configuration.settings, obligation.currency ?? caseCurrency)}</p>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {activeSectionAllowed && activeSection === "resolution" && hasPermission("dispute.resolve") && <DisputeCard
          currency={caseCurrency}
          balance={c.balance}
          obligations={receivableContext?.obligations ?? []}
          disputes={disputes.disputes}
          evidence={disputes.evidence}
          recovery={disputes.recovery}
          loading={disputes.loading}
          create={disputes.create}
          transition={disputes.transition}
        />}

        {/* Promise to Pay */}
        {activeSectionAllowed && activeSection === "resolution" && hasPermission("promise.manage") && <div id="promise-to-pay">
          <PaymentPromiseCard
            currency={caseCurrency}
            balance={c.balance}
            legacyDueDate={c.promise_due_date}
            promises={paymentPromises.promises}
            payments={paymentPromises.payments}
            allocations={paymentPromises.allocations}
            loading={paymentPromises.loading}
            requestCreate={paymentPromises.create}
            requestUpdate={paymentPromises.update}
          />
        </div>}

        {/* Payment plan */}
        {activeSectionAllowed && activeSection === "resolution" && hasPermission("promise.manage") && <CasePaymentPlanSection
          caseId={c.id}
          currency={caseCurrency}
          activePlan={activePlan}
          allPlans={allPlans}
        />}

        {activeSectionAllowed && activeSection === "financials" && <DebtTruthCard
          currency={caseCurrency}
          data={debtTruth.data}
          loading={debtTruth.loading}
          error={debtTruth.error}
        />}

        {activeSectionAllowed && activeSection === "financials" && <DiscrepancyCard
          caseId={caseId}
          currency={caseCurrency}
          canManage={hasPermission("case.manage")}
          data={discrepancies.data}
          loading={discrepancies.loading}
          busy={discrepancies.busy}
          error={discrepancies.error}
          onScan={discrepancies.scan}
          onTransition={discrepancies.transition}
        />}

        {/* Payment history */}
        {activeSectionAllowed && activeSection === "financials" && <CasePaymentHistory
          caseId={c.id}
          caseStatus={c.status}
          currency={caseCurrency}
          payments={payments}
          businessId={businessId ?? "mock-business-id"}
          onApprove={async (id) => {
            const r = await approvePayment(id);
            if (!r.error) refreshPayments();
          }}
          onUpdateCase={update}
        />}
        {activeSectionAllowed && activeSection === "financials" && <FinancialAdjustmentsCard
          currency={caseCurrency}
          caseStatus={c.status}
          outstandingMinor={c.outstanding_minor}
          contractualDueMinor={c.contractual_due_minor}
          statusVersion={c.status_version}
          obligations={receivableContext?.obligations ?? []}
          adjustments={financialAdjustments.adjustments}
          events={financialAdjustments.events}
          loading={financialAdjustments.loading}
          canManageCase={hasPermission("case.manage")}
          canSettle={hasPermission("settlement.approve")}
          canReviewWriteOff={hasPermission("write_off.approve")}
          submit={async (input) => {
            const result = await financialAdjustments.submit(input);
            if (!result.error) {
              refreshCase();
              refreshPayments();
              debtTruth.refresh();
            }
            return result;
          }}
        />}

        {activeSectionAllowed && activeSection === "activity" && <UnifiedCaseTimeline
          currency={caseCurrency}
          events={timeline.events}
          loading={timeline.loading}
          error={timeline.error}
        />}
        {activeSectionAllowed && activeSection === "activity" && !timeline.loading && !timeline.error && timeline.events.length === 0 && (
          <SectionCard title="Timeline">
            <div className="mt-2 rounded-xl bg-[#F2F4F7] p-4 text-center">
              <p className="text-sm font-semibold text-gray-700">No timeline activity yet</p>
              <Link href={`/reminders/${c.id}`} className="mt-2 inline-block text-xs font-bold text-[#009966]">Follow Up →</Link>
            </div>
          </SectionCard>
        )}

        {/* Notes */}
        {activeSectionAllowed && activeSection === "overview" && c.notes && (
          <SectionCard title="Notes">
            <p className="text-sm text-gray-600 leading-relaxed mt-1">{c.notes}</p>
          </SectionCard>
        )}
      </div>

      {/* Sticky bottom action bar */}
      <div className="cb-phone-landscape-mobile fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] left-0 right-0 bg-white border-t border-gray-100 px-4 py-3 flex gap-2 md:hidden">
        <div className="flex-1">
          <PrimaryButton onClick={() => openSection(primaryCaseAction.section)} variant="secondary" size="md" fullWidth icon={<Send className="w-4 h-4" />}>
            {primaryCaseAction.label}
          </PrimaryButton>
        </div>
        {hasSectionAccess("financials") && c.status !== "paid" && c.status !== "closed" && (
          <PrimaryButton onClick={() => openSection("financials")} size="md" className="flex-1" icon={<Banknote className="w-4 h-4" />}>
            Record Payment
          </PrimaryButton>
        )}
      </div>
    </div>
  );
}

// ─── Status selector ──────────────────────────────────────────────────────────

function StatusSelector({
  caseId,
  caseData,
  onUpdate,
}: {
  caseId:      string;
  caseData: CaseRow;
  onUpdate:    (c: CaseRow) => void;
}) {
  const [open,   setOpen]   = useState(false);
  const [saving, setSaving] = useState(false);

  const currentStatus = caseData.status;
  const statuses = caseStatusSchema.options.filter((status) => {
    if (caseData.archived_at || currentStatus === "closed") return false;
    if (status === currentStatus) return true;
    if (!canTransitionCase(currentStatus, status)) return false;
    if (status === "paid") return caseData.balance === 0;
    if (status === "partial_paid") return caseData.amount_paid > 0 && caseData.balance > 0;
    if (status === "formal_demand_ready") return caseData.balance > 0;
    return true;
  });

  async function handleSelect(status: CaseStatusValue) {
    if (status === currentStatus) { setOpen(false); return; }
    setSaving(true);
    setOpen(false);
    const promiseDueDate = status === "payment_promise"
      ? window.prompt("Promised payment due date (YYYY-MM-DD):")?.trim()
      : undefined;
    if (status === "payment_promise" && !promiseDueDate) { setSaving(false); return; }
    const result = await updateCaseStatusClient(caseId, status, {
      promiseDueDate,
      expectedVersion: caseData.status_version,
    });
    if (result.data) {
      onUpdate(result.data);
    }
    setSaving(false);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-700 border border-gray-200 rounded-xl px-3 py-1.5 transition-colors"
        disabled={saving}
      >
        {saving ? (
          <InlineSpinner className="text-gray-400" />
        ) : (
          <>
            <Edit3 className="w-3 h-3" />
            Change Status
            <ChevronDown className="w-3 h-3" />
          </>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-40 bg-white border border-gray-200 rounded-xl shadow-lg py-1 min-w-[180px]">
            {statuses.map((s) => (
              <button
                key={s}
                onClick={() => handleSelect(s)}
                className={cn(
                  "w-full text-left px-3 py-2 text-xs font-semibold hover:bg-gray-50 transition-colors flex items-center justify-between",
                  s === currentStatus ? "text-[#009966]" : "text-gray-700"
                )}
              >
                {STATUS_LABELS[s]}
                {s === currentStatus && <Check className="w-3.5 h-3.5 text-[#009966]" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Next action section ──────────────────────────────────────────────────────

function NextActionSection({
  caseId,
  nextAction,
  businessId,
  canEdit,
  onUpdate,
}: {
  caseId:     string;
  nextAction: string | null;
  businessId: string;
  canEdit:    boolean;
  onUpdate:   (c: CaseRow) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value,   setValue]   = useState(nextAction ?? "");
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    const result = await updateNextActionClient(caseId, value);
    if (result.error) {
      setError(result.error);
    } else if (result.data) {
      onUpdate(result.data);
      await appendAuditLogClient({
        business_id: businessId,
        case_id:     caseId,
        action:      "case.next_action_updated",
        actor_type:  "owner",
        metadata:    { next_best_action: value },
      });
      setEditing(false);
    }
    setSaving(false);
  }

  return (
    <div className="bg-[#0D1B3D] rounded-2xl p-4 text-white">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wide">
          Next Best Action
        </span>
        {canEdit && (
          <button
            onClick={() => { setEditing((v) => !v); setValue(nextAction ?? ""); }}
            className="flex items-center gap-1 text-[11px] text-blue-300 hover:text-white transition-colors"
          >
            <Edit3 className="w-3 h-3" />
            {editing ? "Cancel" : "Edit"}
          </button>
        )}
      </div>

      {editing ? (
        <div className="flex flex-col gap-2 mt-1">
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Describe the next action…"
            maxLength={200}
            className="w-full px-3 py-2.5 bg-white/10 border border-white/20 rounded-xl text-sm text-white placeholder:text-blue-300 outline-none focus:ring-2 focus:ring-emerald-400 transition-all"
          />
          {error && <p className="text-[11px] text-red-300">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-1.5 bg-[#009966] hover:bg-[#00B377] text-white text-xs font-bold py-2 rounded-xl transition-colors disabled:opacity-60"
            >
              {saving ? <InlineSpinner className="text-white" /> : <Check className="w-3.5 h-3.5" />}
              Save
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm font-semibold text-white leading-snug">
          {nextAction ?? (
            <span className="text-blue-300 italic text-xs">No next action set — tap Edit to add one.</span>
          )}
        </p>
      )}
    </div>
  );
}

// ─── Record payment section ───────────────────────────────────────────────────

function RecordPaymentSection({
  caseId,
  businessId,
  balance,
  currency,
  onUpdate,
}: {
  caseId:     string;
  businessId: string;
  balance:    number;
  currency:   string;
  onUpdate:   (c: CaseRow) => void;
}) {
  const { configuration } = useRegion();
  const currencyMetadata = getCurrencyMetadata(currency);
  const money = (value: number) => formatCurrency(value, configuration.settings, currency);
  const [open,    setOpen]    = useState(false);
  const [amount,  setAmount]  = useState("");
  const [notes,   setNotes]   = useState("");
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleRecord() {
    setError(null);
    const parsed = recordPaymentAmountSchema.safeParse({
      amount_paid_additional: amount,
      notes,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid amount");
      return;
    }

    setSaving(true);
    const result = await recordPaymentClient(caseId, amount);
    if (result.error) {
      setError(result.error);
    } else if (result.data) {
      onUpdate(result.data);
      await appendAuditLogClient({
        business_id: businessId,
        case_id:     caseId,
        action:      "payment.recorded",
        actor_type:  "owner",
        metadata:    { amount, notes: notes || null },
      });
      setSuccess(true);
      setAmount("");
      setNotes("");
      setTimeout(() => { setSuccess(false); setOpen(false); }, 2000);
    }
    setSaving(false);
  }

  return (
    <SectionCard
      title="Record Payment"
      action={
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 text-xs text-[#009966] font-semibold"
        >
          <Banknote className="w-3 h-3" />
          {open ? "Close" : "Add"}
        </button>
      }
    >
      <div className="mt-1">
        <p className="text-xs text-gray-500">
          Remaining balance: <span className="font-bold text-gray-800">{money(balance)}</span>
        </p>

        {open && (
          <div className="flex flex-col gap-3 mt-3 pt-3 border-t border-gray-100">
            {success ? (
              <div className="flex items-center gap-2 py-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <p className="text-xs font-semibold text-emerald-700">Payment recorded successfully!</p>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-gray-600">
                    Amount Paid ({currency}) <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-500 pointer-events-none">
                      {currency}
                    </div>
                    <input
                      type="number"
                      min={10 ** -currencyMetadata.minorUnit}
                      step={10 ** -currencyMetadata.minorUnit}
                      placeholder={currencyMetadata.minorUnit === 0 ? "0" : `0.${"0".repeat(currencyMetadata.minorUnit)}`}
                      value={amount}
                      onChange={(e) => { setAmount(e.target.value); setError(null); }}
                      className={cn(
                        "w-full pl-9 pr-4 py-2.5 bg-white border rounded-xl text-sm text-gray-800 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition-all",
                        error ? "border-red-300" : "border-gray-200"
                      )}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-gray-600">Notes (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. DuitNow transfer, Ref: 123"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-800 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition-all"
                  />
                </div>

                {error && (
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                    <p className="text-[11px] text-red-600">{error}</p>
                  </div>
                )}

                <button
                  onClick={handleRecord}
                  disabled={saving || !amount}
                  className="w-full flex items-center justify-center gap-2 bg-[#009966] hover:bg-[#00B377] text-white text-sm font-bold py-2.5 rounded-xl transition-colors disabled:opacity-60"
                >
                  {saving ? <InlineSpinner className="text-white" /> : <Banknote className="w-4 h-4" />}
                  {saving ? "Recording…" : "Record Payment"}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

// ─── Payment lock section ─────────────────────────────────────────────────────

import { type PaymentLockMode } from "@/lib/supabase/types";

const LOCK_CONFIG: Record<PaymentLockMode, {
  label: string; color: string; icon: React.ReactNode; warning?: string;
}> = {
  immediate: {
    label:   "Show Immediately",
    color:   "bg-blue-100 text-blue-700 border-blue-200",
    icon:    <Eye className="w-3 h-3" />,
  },
  approval: {
    label:   "Require Approval",
    color:   "bg-emerald-100 text-emerald-700 border-emerald-200",
    icon:    <ShieldCheck className="w-3 h-3" />,
    warning: "Payment details will only be shown after you approve the debtor's request.",
  },
  manual: {
    label:   "Locked — Manual",
    color:   "bg-orange-100 text-orange-700 border-orange-200",
    icon:    <Lock className="w-3 h-3" />,
    warning: "Payment details are fully locked. You must send them to the debtor manually.",
  },
};

function PaymentLockSection({
  caseId,
  lockMode,
  businessId,
  pendingCount,
  onUpdate,
}: {
  caseId:        string;
  lockMode:      PaymentLockMode;
  businessId:    string;
  pendingCount:  number;
  onUpdate:      (c: CaseRow) => void;
}) {
  const config = LOCK_CONFIG[lockMode];

  return (
    <SectionCard
      title="Payment Lock"
      action={
        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <Link
              href="/payments/requests"
              className="flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full"
            >
              {pendingCount} pending
            </Link>
          )}
          <Link
            href={`/payments/access/${caseId}`}
            className="flex items-center gap-1 text-xs text-[#009966] font-semibold"
          >
            <Edit3 className="w-3 h-3" /> Edit
          </Link>
        </div>
      }
    >
      <div className="mt-2">
        <div className="flex items-center gap-2 mb-2">
          <span className={cn(
            "inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold border",
            config.color
          )}>
            {config.icon}
            {config.label}
          </span>
        </div>
        {config.warning && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
            <Lock className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-700 leading-relaxed">{config.warning}</p>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

// ─── Case payment history ─────────────────────────────────────────────────────

import { type PaymentRow } from "@/lib/supabase/types";

function CasePaymentHistory({
  caseId, caseStatus, currency, payments, businessId, onApprove, onUpdateCase,
}: {
  caseId:      string;
  caseStatus:  CaseRow["status"];
  currency:    string;
  payments:    PaymentRow[];
  businessId:  string;
  onApprove:   (id: string) => void;
  onUpdateCase: (c: CaseRow) => void;
}) {
  const { configuration } = useRegion();
  const money = (value: number, itemCurrency = currency) => formatCurrency(value, configuration.settings, itemCurrency);
  const pendingCount = payments.filter((p) => p.review_status === "pending_review").length;
  const totalApproved = payments
    .filter((p) => p.review_status === "approved")
    .reduce((s, p) => s + p.amount, 0);

  if (payments.length === 0 && pendingCount === 0) {
    return (
      <SectionCard
        title="Payment History"
        action={
          <Link href={`/payments/record/${caseId}`}
            className="flex items-center gap-1 text-xs text-[#009966] font-semibold">
            <Banknote className="w-3 h-3" /> Record
          </Link>
        }
      >
        <p className="text-xs text-gray-400 mt-2 py-2">No payments recorded yet.</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title={`Payment History (${payments.length})`}
      action={
        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <Link href="/payments"
              className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
              {pendingCount} pending
            </Link>
          )}
          <Link href={`/payments/record/${caseId}`}
            className="flex items-center gap-1 text-xs text-[#009966] font-semibold">
            <Banknote className="w-3 h-3" /> Record
          </Link>
        </div>
      }
    >
      <div className="mt-2 flex flex-col gap-1">
        {totalApproved > 0 && (
          <p className="text-[11px] text-gray-500 mb-1">
            Approved: <span className="font-bold text-emerald-700">{money(totalApproved)}</span>
          </p>
        )}
        {payments.slice(0, 5).map((p, i) => {
          const cfg = REVIEW_STATUS_CONFIG[p.review_status];
          const date = formatDateTime(p.created_at, configuration.settings, { dateStyle: "medium", timeStyle: undefined });
          return (
            <div key={p.id} className={cn("flex items-center justify-between py-2",
              i < Math.min(payments.length, 5) - 1 && "border-b border-gray-50")}>
              <div className="flex items-center gap-2 min-w-0">
                <div className={cn("w-2 h-2 rounded-full shrink-0", cfg.dot)} />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-800">{money(p.amount, p.currency ?? currency)}</p>
                  <p className="text-[10px] text-gray-400">{PAYMENT_METHOD_LABELS[p.payment_method]} · {date}</p>
                </div>
              </div>
              <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full border", cfg.bg, cfg.color, cfg.border)}>
                {cfg.label}
              </span>
            </div>
          );
        })}
        {payments.length > 5 && (
          <Link href="/payments" className="text-xs text-[#009966] font-semibold pt-1 text-center">
            View all {payments.length} payments →
          </Link>
        )}
      </div>
    </SectionCard>
  );
}

// ─── Reminder history (compact, in case detail) ──────────────────────────────

export function CaseReminderHistory({
  caseId,
  reminders,
}: {
  caseId:    string;
  reminders: import("@/lib/supabase/types").ReminderRow[];
}) {
  const { configuration } = useRegion();
  return (
    <SectionCard
      title={`Reminder History (${reminders.length})`}
      action={
        <Link
          href={`/reminders/${caseId}`}
          className="flex items-center gap-1 text-xs text-[#009966] font-semibold"
        >
          <Send className="w-3 h-3" /> New
        </Link>
      }
    >
      <div className="flex flex-col mt-1">
        {reminders.slice(0, 5).map((r, i) => {
          const typeDef = REMINDER_TYPES.find((t) => t.id === r.message_type);
          const sentDate = formatDateTime(r.sent_at, configuration.settings, { dateStyle: "medium", timeStyle: undefined });
          return (
            <div
              key={r.id}
              className={cn(
                "flex items-start gap-2.5 py-2.5",
                i < Math.min(reminders.length, 5) - 1 && "border-b border-gray-50"
              )}
            >
              <div className="w-7 h-7 bg-[#F2F4F7] rounded-lg flex items-center justify-center shrink-0 text-sm">
                {typeDef?.emoji ?? "📩"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-xs font-semibold text-gray-800">
                    {typeDef?.label ?? r.message_type}
                  </p>
                  <span className={cn(
                    "inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold border",
                    REMINDER_STATUS_COLORS[r.status] ?? "bg-gray-100 text-gray-600 border-gray-200"
                  )}>
                    {REMINDER_STATUS_LABELS[r.status] ?? r.status}
                  </span>
                </div>
                <p className="text-[10px] text-gray-400 mt-0.5">{sentDate}</p>
              </div>
            </div>
          );
        })}
        {reminders.length > 5 && (
          <Link
            href={`/reminders/${caseId}`}
            className="text-xs text-[#009966] font-semibold pt-2 text-center"
          >
            View all {reminders.length} reminders →
          </Link>
        )}
      </div>
    </SectionCard>
  );
}

// ─── Evidence completeness section ───────────────────────────────────────────

import { type EvidenceFileRow as EvidenceFile } from "@/lib/supabase/types";

function EvidenceCompletenessSection({
  caseId,
  evidenceFiles,
}: {
  caseId:        string;
  evidenceFiles: EvidenceFile[];
}) {
  const uploadedTypes = new Set(evidenceFiles.map((f) => f.evidence_type));
  const mustHave   = evidenceTypes.filter((e) => e.category === "must_have");
  const goodToHave = evidenceTypes.filter((e) => e.category === "good_to_have");

  const mustDone = mustHave.filter((e) => uploadedTypes.has(e.id as DbEvidenceType)).length;
  const goodDone = goodToHave.filter((e) => uploadedTypes.has(e.id as DbEvidenceType)).length;
  const totalDone = mustDone + goodDone;
  const total = evidenceTypes.length;
  const pct = total > 0 ? Math.round((totalDone / total) * 100) : 0;

  const barColor =
    pct >= 75 ? "bg-emerald-500" :
    pct >= 40 ? "bg-amber-500" : "bg-red-400";

  const missingMust = mustHave.filter((e) => !uploadedTypes.has(e.id as DbEvidenceType));

  return (
    <SectionCard
      title="Evidence Completeness"
      action={
        <Link
          href={`/evidence/${caseId}`}
          className="flex items-center gap-1 text-xs text-[#009966] font-semibold"
        >
          <Upload className="w-3 h-3" /> Upload
        </Link>
      }
    >
      <div className="mt-2">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-gray-500">
            {totalDone} of {total} documents · {mustDone}/{mustHave.length} must-have
          </p>
          <p className="text-sm font-black text-[#0D1B3D]">{pct}%</p>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-2 mb-3">
          <div
            className={cn("h-2 rounded-full transition-all", barColor)}
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Status indicator */}
        {mustDone === mustHave.length ? (
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <p className="text-[11px] text-emerald-700 font-semibold">
              All must-have documents uploaded
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-[11px] text-amber-600 font-semibold">
              {missingMust.length} must-have document{missingMust.length > 1 ? "s" : ""} missing:
            </p>
            {missingMust.map((e) => (
              <div key={e.id} className="flex items-center gap-1.5">
                <span className="text-sm">{e.icon}</span>
                <p className="text-[11px] text-gray-600">{e.name}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

// ─── Case Small Claim Section ────────────────────────────────────────────────

function CaseSmallClaimSection({
  caseId,
  legalDocs,
}: {
  caseId:    string;
  legalDocs: LegalDocumentRow[];
}) {
  const { configuration } = useRegion();
  const savedPacks    = legalDocs.filter((d) => d.document_type === "small_claim_pack");
  const latestPack    = savedPacks[0] ?? null;

  let latestMeta: { readiness_pct?: number; readiness_status?: string } = {};
  if (latestPack) {
    try { latestMeta = JSON.parse(latestPack.content); } catch { /* ignore */ }
  }
  const statusCfg = latestMeta.readiness_status
    ? SMALL_CLAIM_STATUS_CONFIG[latestMeta.readiness_status as keyof typeof SMALL_CLAIM_STATUS_CONFIG]
    : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-bold text-gray-800">Small Claim Readiness</p>
        <Link
          href={`/legal/${caseId}/smallclaim`}
          className={cn(
            "text-xs font-semibold hover:text-emerald-700",
            "text-[#009966]"
          )}
        >
          {savedPacks.length > 0 ? "View Export" : "+ Check Readiness"}
        </Link>
      </div>

      {savedPacks.length === 0 ? (
        <Link href={`/legal/${caseId}/smallclaim`}>
          <div className="flex items-center gap-3 bg-[#F2F4F7] border border-dashed border-gray-200 rounded-2xl px-4 py-3.5 hover:border-[#009966] hover:bg-emerald-50 transition-all">
            <div className="w-9 h-9 rounded-xl bg-white border border-gray-200 flex items-center justify-center shrink-0">
              <FileText className="w-4 h-4 text-gray-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-700">No readiness snapshot yet</p>
              <p className="text-xs text-gray-400">Check factual completeness and prepare a Case Evidence Export</p>
            </div>
          </div>
        </Link>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-[#009966]" />
              <p className="text-sm font-bold text-gray-900">Case Evidence Export</p>
            </div>
            {statusCfg && (
              <span className={cn(
                "text-[10px] font-bold px-2 py-0.5 rounded-full border",
                statusCfg.color, statusCfg.bg, statusCfg.border
              )}>
                {statusCfg.label}
              </span>
            )}
          </div>
          <div className="px-4 py-3 flex flex-col gap-1.5">
            {latestMeta.readiness_pct != null && (
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                  <div
                    className={cn("h-1.5 rounded-full", latestMeta.readiness_pct >= 80 ? "bg-emerald-500" : latestMeta.readiness_pct >= 50 ? "bg-amber-400" : "bg-red-400")}
                    style={{ width: `${latestMeta.readiness_pct}%` }}
                  />
                </div>
                <span className="text-xs font-bold text-gray-600 shrink-0">{latestMeta.readiness_pct}%</span>
              </div>
            )}
            <p className="text-[10px] text-gray-400">
              {latestPack && formatDateTime(latestPack.created_at, configuration.settings, { dateStyle: "medium", timeStyle: undefined })}
              {savedPacks.length > 1 && ` · ${savedPacks.length} packs saved`}
            </p>
          </div>
          <div className="border-t border-gray-50">
            <Link
              href={`/legal/${caseId}/smallclaim`}
              className="flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold text-[#009966] hover:bg-emerald-50 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              View Small Claim Readiness
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Case Lawyer Referral Section ────────────────────────────────────────────

function CaseLawyerReferralSection({
  caseId,
  latestReferral,
}: {
  caseId:         string;
  latestReferral: LawyerReferralRow | null;
}) {
  const { configuration } = useRegion();
  const cfg = latestReferral
    ? REFERRAL_STATUS_CONFIG[latestReferral.referral_status]
    : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-bold text-gray-800">Professional Legal Handoff</p>
        <Link
          href={`/legal/${caseId}/lawyer`}
          className="text-xs font-semibold text-[#009966] hover:text-emerald-700"
        >
          {latestReferral ? "View / Update" : "Request Legal Review"}
        </Link>
      </div>

      {!latestReferral ? (
        <Link href={`/legal/${caseId}/lawyer`}>
          <div className="flex items-center gap-3 bg-[#F2F4F7] border border-dashed border-gray-200 rounded-2xl px-4 py-3.5 hover:border-[#009966] hover:bg-emerald-50 transition-all">
            <div className="w-9 h-9 rounded-xl bg-white border border-gray-200 flex items-center justify-center shrink-0">
              <Send className="w-4 h-4 text-gray-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-700">No professional handoff prepared</p>
              <p className="text-xs text-gray-400">Prepare the case for external legal review</p>
            </div>
          </div>
        </Link>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
            <div className="flex items-center gap-2">
              <Send className="w-4 h-4 text-[#009966]" />
              <p className="text-sm font-bold text-gray-900">Legal Handoff</p>
            </div>
            {cfg && (
              <span className={cn(
                "text-[10px] font-bold px-2 py-0.5 rounded-full border",
                cfg.color, cfg.bg, cfg.border
              )}>
                {cfg.label}
              </span>
            )}
          </div>
          <div className="px-4 py-3 flex flex-col gap-2">
            {latestReferral.partner_name && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">External professional</span>
                <span className="text-xs font-semibold text-gray-800">{latestReferral.partner_name}</span>
              </div>
            )}
            {latestReferral.partner_firm && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Firm</span>
                <span className="text-xs font-semibold text-gray-800">{latestReferral.partner_firm}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Submitted</span>
              <span className="text-xs font-semibold text-gray-800">
                {formatDateTime(latestReferral.created_at, configuration.settings, { dateStyle: "medium", timeStyle: undefined })}
              </span>
            </div>
          </div>
          <div className="border-t border-gray-50">
            <Link
              href={`/legal/${caseId}/lawyer`}
              className="flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold text-[#009966] hover:bg-emerald-50 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              View Handoff Details
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Case Formal Demands Section ─────────────────────────────────────────────

function CaseFormalDemandsSection({
  caseId,
  legalDocs,
}: {
  caseId:    string;
  legalDocs: LegalDocumentRow[];
}) {
  const { configuration } = useRegion();
  const demands = legalDocs.filter((d) =>
    ["demand_standard", "demand_firm", "demand_final"].includes(d.document_type)
  );

  const TONE_LABELS: Record<string, string> = {
    demand_standard: "Formal Payment Reminder",
    demand_firm:     "Firm Payment Reminder",
    demand_final:    "Final Payment Notice",
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-bold text-gray-800">Formal Payment Reminder</p>
        <Link
          href={`/legal/${caseId}/demand`}
          className="text-xs font-semibold text-[#009966] hover:text-emerald-700"
        >
          {demands.length > 0 ? "View / Edit" : "+ Create Draft"}
        </Link>
      </div>

      {demands.length === 0 ? (
        <Link href={`/legal/${caseId}/demand`}>
          <div className="flex items-center gap-3 bg-[#F2F4F7] border border-dashed border-gray-200 rounded-2xl px-4 py-3.5 hover:border-[#009966] hover:bg-emerald-50 transition-all">
            <div className="w-9 h-9 rounded-xl bg-white border border-gray-200 flex items-center justify-center shrink-0">
              <FileText className="w-4 h-4 text-gray-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-700">No payment notice draft yet</p>
              <p className="text-xs text-gray-400">Prepare a factual creditor payment reminder</p>
            </div>
          </div>
        </Link>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-[#009966]" />
              <p className="text-sm font-bold text-gray-900">{demands.length} Payment Notice Draft{demands.length > 1 ? "s" : ""}</p>
            </div>
            <span className="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
              Saved
            </span>
          </div>
          <div className="px-4 py-3 flex flex-col gap-2">
            {demands.slice(0, 2).map((d) => {
              let meta: { generated_at?: string; deadline_days?: number } = {};
              try { meta = JSON.parse(d.content); } catch { /* ignore */ }
              return (
                <div key={d.id} className="flex items-center gap-2.5">
                  <FileText className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-700 truncate">
                      {TONE_LABELS[d.document_type] ?? d.document_type}
                    </p>
                    <p className="text-[10px] text-gray-400">
                      {meta.generated_at
                        ? formatDateTime(meta.generated_at, configuration.settings, { dateStyle: "medium", timeStyle: undefined })
                        : formatDateTime(d.created_at, configuration.settings, { dateStyle: "medium", timeStyle: undefined })}
                      {meta.deadline_days ? ` · ${meta.deadline_days}-day deadline` : ""}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="border-t border-gray-50">
            <Link
              href={`/legal/${caseId}/demand`}
              className="flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold text-[#009966] hover:bg-emerald-50 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              View & Create Payment Notice
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Case Evidence Pack Section ──────────────────────────────────────────────

function CaseEvidencePackSection({
  caseId,
  legalDocs,
}: {
  caseId:    string;
  legalDocs: LegalDocumentRow[];
}) {
  const { configuration } = useRegion();
  const packs = legalDocs.filter((d) => d.document_type === "evidence_pack");

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-bold text-gray-800">Case Evidence Export</p>
        <Link
          href={`/evidence/${caseId}/pack`}
          className="text-xs font-semibold text-[#009966] hover:text-emerald-700"
        >
          {packs.length > 0 ? "View / Export" : "Preview & Export"}
        </Link>
      </div>

      {packs.length === 0 ? (
        <Link href={`/evidence/${caseId}/pack`}>
          <div className="flex items-center gap-3 bg-[#F2F4F7] border border-dashed border-gray-200 rounded-2xl px-4 py-3.5 hover:border-[#009966] hover:bg-emerald-50 transition-all">
            <div className="w-9 h-9 rounded-xl bg-white border border-gray-200 flex items-center justify-center shrink-0">
              <FileText className="w-4 h-4 text-gray-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-700">No PDF exported yet</p>
              <p className="text-xs text-gray-400">Preview and export factual case evidence</p>
            </div>
          </div>
        </Link>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-[#009966]" />
              <p className="text-sm font-bold text-gray-900">{packs.length} Case Evidence Export{packs.length > 1 ? "s" : ""}</p>
            </div>
            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
              Exported
            </span>
          </div>
          <div className="px-4 py-3 flex flex-col gap-2">
            {packs.slice(0, 2).map((pack) => {
              let meta: { generated_at?: string; evidence_score?: number; file_count?: number } = {};
              try { meta = JSON.parse(pack.content); } catch { /* ignore */ }
              return (
                <div key={pack.id} className="flex items-center gap-2.5">
                  <Download className="w-3.5 h-3.5 text-[#009966] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-700 truncate">{pack.title}</p>
                    <p className="text-[10px] text-gray-400">
                      {meta.generated_at
                        ? formatDateTime(meta.generated_at, configuration.settings, { dateStyle: "medium", timeStyle: undefined })
                        : formatDateTime(pack.created_at, configuration.settings, { dateStyle: "medium", timeStyle: undefined })}
                      {meta.evidence_score != null ? ` · ${meta.evidence_score}% complete` : ""}
                      {meta.file_count != null ? ` · ${meta.file_count} files` : ""}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="border-t border-gray-50">
            <Link
              href={`/evidence/${caseId}/pack`}
              className="flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold text-[#009966] hover:bg-emerald-50 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              View & Re-export
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Case Payment Plan Section ───────────────────────────────────────────────

function CasePaymentPlanSection({
  caseId,
  currency,
  activePlan,
  allPlans,
}: {
  caseId:     string;
  currency:   string;
  activePlan: PaymentPlanDetails | null;
  allPlans:   PaymentPlanDetails[];
}) {
  const { configuration } = useRegion();
  const planMoney = (value: number, itemCurrency = activePlan?.currency ?? currency) => formatCurrency(value, configuration.settings, itemCurrency);
  const minorMoney = (value: number, itemCurrency = activePlan?.currency ?? currency) => formatMinorCurrency(value, configuration.settings, itemCurrency);
  const planDate = (value: string) => formatCalendarDate(value, configuration.settings);
  const completedCount = activePlan?.installments.filter((item) => item.status === "paid").length ?? 0;
  const paidMinor = activePlan?.installments.reduce((sum, item) => sum + Number(item.paid_minor), 0) ?? 0;
  const scheduledMinor = activePlan?.installments.reduce((sum, item) => sum + Number(item.amount_minor), 0) ?? 0;
  const progress = scheduledMinor > 0 ? Math.min(100, Math.round((paidMinor / scheduledMinor) * 100)) : 0;
  const nextInstallment = activePlan?.installments.find((item) => Number(item.paid_minor) < Number(item.amount_minor)) ?? null;
  const eventLabels: Record<string, string> = {
    due_soon: "Installment due soon",
    due_today: "Installment due today",
    missed: "Installment missed",
    partial_payment: "Partial payment allocated",
    paid: "Installment paid",
    plan_completed: "Payment plan completed",
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-bold text-gray-800">Payment Plan</p>
        <Link
          href={`/legal/${caseId}/plan`}
          className="text-xs font-semibold text-[#009966] hover:text-emerald-700"
        >
          {activePlan ? "View Plan" : "+ Create Plan"}
        </Link>
      </div>

      {!activePlan ? (
        <Link href={`/legal/${caseId}/plan`}>
          <div className="flex items-center gap-3 bg-[#F2F4F7] border border-dashed border-gray-200 rounded-2xl px-4 py-3.5 hover:border-[#009966] hover:bg-emerald-50 transition-all">
            <div className="w-9 h-9 rounded-xl bg-white border border-gray-200 flex items-center justify-center shrink-0">
              <ClipboardList className="w-4 h-4 text-gray-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-700">No payment plan yet</p>
              <p className="text-xs text-gray-400">Tap to create an instalment schedule</p>
            </div>
          </div>
        </Link>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {/* Plan header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-[#009966]" />
              <p className="text-sm font-bold text-gray-900">Active Plan</p>
            </div>
            <span className={cn(
              "text-[10px] font-bold px-2 py-0.5 rounded-full border",
              activePlan.debtor_confirmed
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-amber-50 text-amber-700 border-amber-200"
            )}>
              {activePlan.debtor_confirmed ? "Debtor Confirmed" : "Awaiting Confirmation"}
            </span>
          </div>

          {/* Plan stats */}
          <div className="px-4 py-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Total Amount</span>
              <span className="text-sm font-bold text-gray-800">{planMoney(activePlan.total_amount)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Instalments</span>
              <span className="text-sm font-bold text-gray-800">
                {completedCount}/{activePlan.installment_count} done · {planMoney(activePlan.installment_amount)} each
              </span>
            </div>
            {/* Progress bar */}
            <div className="w-full bg-gray-100 rounded-full h-1.5 mt-0.5">
              <div
                className="bg-[#009966] h-1.5 rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Next Due</span>
              <span className="text-sm font-bold text-gray-800">
                {nextInstallment
                  ? `${planDate(nextInstallment.due_date)} · ${minorMoney(Number(nextInstallment.amount_minor) - Number(nextInstallment.paid_minor), nextInstallment.currency ?? activePlan.currency ?? currency)} remaining`
                  : "All done"}
              </span>
            </div>
            {activePlan.events.length > 0 && (
              <ol className="mt-1 border-t border-gray-50 pt-2" aria-label="Payment-plan timeline">
                {activePlan.events.slice(0, 3).map((event) => (
                  <li key={event.id} className="flex items-center justify-between gap-3 py-1 text-[11px]">
                    <span className={event.event_type === "missed" ? "font-semibold text-red-600" : "text-gray-600"}>
                      {eventLabels[event.event_type]}
                    </span>
                    <time className="shrink-0 text-gray-400">{planDate(event.event_date)}</time>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* Footer links */}
          <div className="flex border-t border-gray-50">
            <Link
              href={`/legal/${caseId}/plan`}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              View Full Plan
            </Link>
            <div className="w-px bg-gray-100" />
            <Link
              href={`/legal/${caseId}/acknowledge`}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold text-[#009966] hover:bg-emerald-50 transition-colors"
            >
              <FileText className="w-3.5 h-3.5" />
              Acknowledgement
            </Link>
          </div>
        </div>
      )}

      {/* Plan history (if more than active) */}
      {allPlans.length > 1 && (
        <div className="mt-2">
          <p className="text-[10px] text-gray-400 font-semibold mb-1.5">Plan History ({allPlans.length})</p>
          <div className="flex flex-col gap-1">
            {allPlans.filter((p) => p.id !== activePlan?.id).map((p) => (
              <div key={p.id} className="flex items-center justify-between bg-[#F2F4F7] rounded-xl px-3 py-2">
                <div>
                  <p className="text-xs font-semibold text-gray-700">
                    {p.installment_count}× {planMoney(p.installment_amount, p.currency ?? currency)}
                  </p>
                  <p className="text-[10px] text-gray-400">{planDate(p.start_date)}</p>
                </div>
                <span className={cn(
                  "text-[10px] font-bold px-2 py-0.5 rounded-full",
                  p.status === "completed" ? "bg-emerald-100 text-emerald-700" :
                  p.status === "cancelled" ? "bg-red-50 text-red-600" :
                  "bg-gray-200 text-gray-500"
                )}>
                  {p.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Amount chip ──────────────────────────────────────────────────────────────

function CasePrioritySnapshot({ summary, loading, error, currency, moneyMinor, dateTime, calendarDate }: {
  summary: CasePrioritySummary | null;
  loading: boolean;
  error: string | null;
  currency: string;
  moneyMinor: (minor: number, currency: string) => string;
  dateTime: (value: string) => string;
  calendarDate: (value: string) => string;
}) {
  if (loading) return <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Loading case priority summary">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-16 animate-pulse rounded-xl bg-slate-100" />)}</div>;
  if (error || !summary) return <div role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">The reconciled case summary is unavailable. Balance categories are hidden rather than estimated.</div>;
  const amountCards = [
    { label: "Verified outstanding", value: summary.amounts.verifiedOutstandingMinor, tone: "text-blue-800", detail: "Ledger-backed and not actively disputed" },
    { label: "Disputed", value: summary.amounts.disputedMinor, tone: "text-red-800", detail: "Active structured disputes" },
    { label: "Unverified", value: summary.amounts.unverifiedProofMinor, tone: "text-amber-800", detail: "Submitted proof awaiting review" },
    { label: "Settled / adjusted", value: summary.amounts.settledOrAdjustedMinor, tone: "text-emerald-800", detail: "Reduction from original principal" },
  ];
  return <div className="mt-3 space-y-2">
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Reconciled amount status">
      {amountCards.map((item) => <div key={item.label} className="rounded-xl border border-slate-100 bg-white p-2.5"><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{item.label}</dt><dd className={cn("mt-1 text-sm font-black", item.tone)}>{moneyMinor(item.value, currency)}</dd><p className="mt-0.5 text-[9px] leading-tight text-slate-400">{item.detail}</p></div>)}
    </dl>
    <dl className="grid gap-2 sm:grid-cols-3" aria-label="Case decision status">
      <div className="rounded-xl border border-slate-100 bg-white p-2.5"><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Verification status</dt><dd className="mt-1 text-xs font-bold text-slate-700">{summary.balanceVerification === "ledger_verified" ? "Ledger verified" : "Legacy balance · verify records"}</dd><p className="mt-0.5 text-[9px] text-slate-400">Receiving account: {summary.receivingAccountVerification.replaceAll("_", " ")}</p></div>
      <div className="rounded-xl border border-slate-100 bg-white p-2.5"><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Latest approved payment</dt><dd className="mt-1 text-xs font-bold text-slate-700">{summary.latestPayment ? moneyMinor(summary.latestPayment.amountMinor, summary.latestPayment.currency) : "No approved payment"}</dd>{summary.latestPayment && <p className="mt-0.5 text-[9px] text-slate-400">{dateTime(summary.latestPayment.createdAt)}</p>}</div>
      <div className="rounded-xl border border-slate-100 bg-white p-2.5"><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Open dispute</dt><dd className="mt-1 text-xs font-bold text-slate-700">{summary.openDispute ? moneyMinor(summary.openDispute.disputedMinor, currency) : "None"}</dd>{summary.openDispute && <p className="mt-0.5 text-[9px] capitalize text-slate-400">{summary.openDispute.status.replaceAll("_", " ")}</p>}</div>
      <div className="rounded-xl border border-slate-100 bg-white p-2.5"><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Promise status</dt><dd className="mt-1 text-xs font-bold capitalize text-slate-700">{summary.promise ? summary.promise.status.replaceAll("_", " ") : "No active promise"}</dd>{summary.promise && <p className="mt-0.5 text-[9px] text-slate-400">{moneyMinor(summary.promise.promisedMinor, currency)} due {calendarDate(summary.promise.promiseDate)}</p>}</div>
      <div className="rounded-xl border border-slate-100 bg-white p-2.5"><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Evidence status</dt><dd className="mt-1 text-xs font-bold text-slate-700">{summary.evidenceCount > 0 ? `${summary.evidenceCount} file${summary.evidenceCount === 1 ? "" : "s"}` : "Missing"}</dd></div>
      <div className="rounded-xl border border-slate-100 bg-white p-2.5"><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Payment proofs</dt><dd className="mt-1 text-xs font-bold text-slate-700">{summary.pendingProofCount > 0 ? `${summary.pendingProofCount} awaiting review` : "None awaiting review"}</dd></div>
    </dl>
  </div>;
}

function AmountChip({
  label,
  value,
  sub,
  subColor,
  icon,
}: {
  label:     string;
  value:     string;
  sub?:      string;
  subColor?: string;
  icon?:     React.ReactNode;
}) {
  return (
    <div className="bg-[#F2F4F7] rounded-xl p-2.5">
      <div className="flex items-center gap-1 text-[10px] text-gray-400 mb-1">
        {icon}
        {label}
      </div>
      <p className="text-xs font-bold text-gray-800 leading-tight truncate">{value}</p>
      {sub && <p className={cn("text-[10px] font-semibold mt-0.5", subColor)}>{sub}</p>}
    </div>
  );
}
