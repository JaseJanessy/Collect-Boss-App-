import "server-only";

import { parseCurrencyToMinor } from "@/lib/financial/money";
import type { CasePrioritySummary } from "@/lib/cases/priority-summary";
import type { AppSupabaseClient } from "@/lib/supabase/client";
import type {
  CaseRecoveryAmountsRow,
  CaseRow,
  DisputeRow,
  PaymentPromiseRow,
  PaymentRow,
  ReceivingAccountRow,
} from "@/lib/supabase/types";

function minorFromMajor(value: unknown, currency: string) {
  return Number(parseCurrencyToMinor(String(value ?? 0), currency));
}

export async function buildCasePrioritySummary(
  client: AppSupabaseClient,
  businessId: string,
  currentCase: CaseRow,
): Promise<CasePrioritySummary> {
  const caseId = currentCase.id;
  const activeDisputeStatuses = ["submitted", "under_review", "information_requested", "partially_accepted"];
  const [recoveryResult, paymentResult, disputeResult, promiseResult, evidenceResult, proofsResult, accountResult] = await Promise.all([
    client.from("case_recovery_amounts").select("*").eq("business_id", businessId).eq("case_id", caseId).maybeSingle(),
    client.from("payments").select("*").eq("case_id", caseId).eq("review_status", "approved").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    client.from("disputes").select("*").eq("business_id", businessId).eq("case_id", caseId).in("status", activeDisputeStatuses).order("submitted_at", { ascending: false }).limit(1).maybeSingle(),
    client.from("payment_promises").select("*").eq("business_id", businessId).eq("case_id", caseId).in("status", ["pending", "partially_fulfilled", "missed"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    client.from("evidence_files").select("id", { count: "exact", head: true }).eq("case_id", caseId).is("archived_at", null),
    client.from("public_payment_submissions").select("amount,status,created_at").eq("business_id", businessId).eq("case_id", caseId).in("status", ["pending_review", "submitted", "under_review", "more_information_required"]),
    currentCase.receiving_account_id
      ? client.from("receiving_accounts").select("verification_status").eq("business_id", businessId).eq("id", currentCase.receiving_account_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const queryError = recoveryResult.error || paymentResult.error || disputeResult.error || promiseResult.error
    || evidenceResult.error || proofsResult.error || accountResult.error;
  if (queryError) throw new Error("Unable to reconcile the case priority summary.");

  const recovery = recoveryResult.data as CaseRecoveryAmountsRow | null;
  const latestPayment = paymentResult.data as PaymentRow | null;
  const openDispute = disputeResult.data as DisputeRow | null;
  const promise = promiseResult.data as PaymentPromiseRow | null;
  const account = accountResult.data as Pick<ReceivingAccountRow, "verification_status"> | null;
  const proofRows = proofsResult.data ?? [];
  const unverifiedProofMinor = proofRows.reduce((total, proof) => total + minorFromMajor(proof.amount, currentCase.currency), 0);
  const disputedMinor = Math.max(0, Number(recovery?.active_disputed_minor ?? openDispute?.disputed_amount_minor ?? 0));
  const verifiedOutstandingMinor = Math.max(0, Number(recovery?.collectable_minor ?? currentCase.outstanding_minor) - (recovery ? 0 : disputedMinor));
  const settledOrAdjustedMinor = Math.max(0, Number(currentCase.original_principal_minor) - Number(currentCase.outstanding_minor));
  const evidenceCount = evidenceResult.count ?? 0;
  const riskFlags = [
    currentCase.days_overdue >= 90 ? "90+ days overdue" : currentCase.days_overdue >= 30 ? "30+ days overdue" : null,
    currentCase.priority === "urgent" || currentCase.priority === "high" ? `${currentCase.priority} priority` : null,
    openDispute ? "Open dispute" : null,
    promise?.status === "missed" ? "Missed promise" : null,
    proofRows.length > 0 ? `${proofRows.length} unreviewed payment proof${proofRows.length === 1 ? "" : "s"}` : null,
    evidenceCount === 0 && currentCase.outstanding_minor > 0 ? "Evidence missing" : null,
    account && account.verification_status !== "verified" ? `Receiving account ${account.verification_status}` : null,
  ].filter((flag): flag is string => Boolean(flag));
  const nextAction = openDispute
    ? { label: "Review open dispute", href: `/cases/${encodeURIComponent(caseId)}?section=resolution` }
    : proofRows.length > 0
      ? { label: "Review payment proof", href: "/payments" }
      : promise?.status === "missed"
        ? { label: "Follow up missed promise", href: `/cases/${encodeURIComponent(caseId)}?section=resolution` }
        : evidenceCount === 0 && currentCase.outstanding_minor > 0
          ? { label: "Upload case evidence", href: `/evidence/${encodeURIComponent(caseId)}` }
          : { label: currentCase.next_best_action?.trim() || "Review case activity", href: `/cases/${encodeURIComponent(caseId)}?section=activity` };

  return {
    amounts: { verifiedOutstandingMinor, disputedMinor, unverifiedProofMinor, settledOrAdjustedMinor },
    balanceVerification: currentCase.financial_version > 0 ? "ledger_verified" : "legacy_unverified",
    receivingAccountVerification: account?.verification_status ?? "not_configured",
    latestPayment: latestPayment ? {
      amountMinor: Number(latestPayment.amount_minor ?? minorFromMajor(latestPayment.amount, latestPayment.currency ?? currentCase.currency)),
      currency: latestPayment.currency ?? currentCase.currency,
      createdAt: latestPayment.created_at,
    } : null,
    openDispute: openDispute ? { disputedMinor: openDispute.disputed_amount_minor, status: openDispute.status, submittedAt: openDispute.submitted_at } : null,
    promise: promise ? { promisedMinor: promise.promised_amount_minor, fulfilledMinor: promise.amount_fulfilled_minor, status: promise.status, promiseDate: promise.promise_date } : null,
    evidenceCount,
    pendingProofCount: proofRows.length,
    nextAction,
    riskFlags,
  };
}
