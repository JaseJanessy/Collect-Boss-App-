import "server-only";

import { hashPaymentSession, maskEmail, maskPhone } from "@/lib/payment-access/otp-crypto";
import { getServiceClient } from "@/lib/supabase/service-client";
import { hashPublicToken } from "./token";
export { generatePublicToken, hashPublicToken, redactPublicToken } from "./token";
import type {
  PublicAccessResolution,
  PublicAcknowledgementDetails,
  PublicPaymentDetails,
} from "./types";
import { minorToMajorNumber } from "@/lib/financial/money";

export type PublicAccessPurpose = "payment" | "acknowledgement";

interface TokenRow {
  id: string;
  business_id: string;
  purpose: PublicAccessPurpose;
  case_id: string;
  payment_plan_id: string | null;
  payment_access_request_id: string | null;
  receiving_account_id: string | null;
  expires_at: string;
  revoked_at: string | null;
  consumed_at: string | null;
}

interface CaseScope {
  id: string;
  business_id: string;
  status: string;
  archived_at: string | null;
  outstanding_minor: string | number | null;
  currency: string;
}

export type PublicActionContext =
  | {
      state: "valid";
      token: TokenRow;
      caseScope: CaseScope;
    }
  | { state: Exclude<PublicAccessResolution<never>["state"], "valid"> };

function validTokenFormat(token: string): boolean {
  return /^[A-Za-z0-9_-]{32,256}$/.test(token);
}


function tokenState(token: TokenRow): Exclude<PublicActionContext["state"], "valid"> | "valid" {
  if (token.revoked_at || new Date(token.expires_at).getTime() <= Date.now()) {
    return "expired";
  }
  if (token.consumed_at) return "used";
  return "valid";
}

/**
 * Validates an opaque capability and resolves the token's tenant scope. This
 * module is server-only: browser code never receives the service-role client.
 */
export async function getPublicActionContext(
  rawToken: string,
  purpose: PublicAccessPurpose,
): Promise<PublicActionContext> {
  if (!validTokenFormat(rawToken)) return { state: "invalid" };

  const client = await getServiceClient();
  if (!client) return { state: "unavailable" };

  const { data: tokenData, error: tokenError } = await client
    .from("public_access_tokens")
    .select("id, business_id, purpose, case_id, payment_plan_id, payment_access_request_id, receiving_account_id, expires_at, revoked_at, consumed_at")
    .eq("token_hash", hashPublicToken(rawToken))
    .maybeSingle();

  if (tokenError) return { state: "unavailable" };
  if (!tokenData) return { state: "invalid" };

  const token = tokenData as TokenRow;
  if (token.purpose !== purpose) return { state: "invalid" };

  const state = tokenState(token);
  if (state !== "valid") return { state };

  const { data: caseData, error: caseError } = await client
    .from("cases")
    .select("id, business_id, status, archived_at, outstanding_minor, currency")
    .eq("id", token.case_id)
    .eq("business_id", token.business_id)
    .maybeSingle();

  if (caseError) return { state: "unavailable" };
  if (!caseData) return { state: "invalid" };

  return {
    state: "valid",
    token,
    caseScope: caseData as CaseScope,
  };
}

export async function resolvePublicPayment(
  rawToken: string,
  rawSession?: string | null,
): Promise<PublicAccessResolution<PublicPaymentDetails>> {
  const context = await getPublicActionContext(rawToken, "payment");
  if (context.state !== "valid") return context;

  const client = await getServiceClient();
  if (!client) return { state: "unavailable" };

  const { data: caseData, error: caseError } = await client
    .from("cases")
    .select("balance, amount_owed, due_date, invoice_no, status, archived_at, payment_lock_mode, debtor_id, debtor_email, debtor_phone")
    .eq("id", context.caseScope.id)
    .eq("business_id", context.caseScope.business_id)
    .maybeSingle();

  if (caseError || !caseData) return { state: caseError ? "unavailable" : "invalid" };

  const c = caseData as {
    balance: number | string | null; amount_owed: number | string | null; due_date: string | null; invoice_no: string | null;
    status: string; archived_at: string | null; payment_lock_mode: "immediate" | "approval" | "manual";
    debtor_id: string | null; debtor_email: string | null; debtor_phone: string | null;
  };
  if (c.status === "closed" || c.status === "paid" || c.archived_at || !context.token.receiving_account_id || c.payment_lock_mode === "manual") return { state: "invalid" };
  const { data: businessData, error: businessError } = await client.from("businesses")
    .select("business_name, legal_name, phone, email, verification_state").eq("id", context.caseScope.business_id).maybeSingle();
  if (businessError || !businessData) return { state: businessError ? "unavailable" : "invalid" };
  const business = businessData as {
    business_name: string; legal_name: string | null; phone: string | null; email: string | null;
    verification_state: PublicPaymentDetails["creditor"]["verificationState"];
  };
  const { data: businessAccess, error: businessAccessError } = await client.rpc("business_payment_link_access", {
    p_business_id: context.caseScope.business_id,
  });
  if (businessAccessError) return { state: "unavailable" };
  if (!(businessAccess as { allowed?: boolean }).allowed) return { state: "invalid" };
  const { data: debtorData, error: debtorError } = c.debtor_id
    ? await client.from("debtors").select("email, phone").eq("id", c.debtor_id).eq("business_id", context.caseScope.business_id).maybeSingle()
    : { data: null, error: null };
  if (debtorError) return { state: "unavailable" };
  const debtor = debtorData as { email: string | null; phone: string | null } | null;
  const registeredEmail = debtor?.email?.trim() || c.debtor_email?.trim() || null;
  const registeredPhone = debtor?.phone?.trim() || c.debtor_phone?.trim() || null;
  const otpChannels: PublicPaymentDetails["otp"]["channels"] = [
    ...(registeredEmail ? [{ channel: "email" as const, maskedDestination: maskEmail(registeredEmail) }] : []),
    ...(registeredPhone ? [{ channel: "sms" as const, maskedDestination: maskPhone(registeredPhone) }] : []),
  ];
  const { data: paymentRows, error: paymentError } = await client.from("payments")
    .select("amount_minor, currency, created_at").eq("case_id", context.caseScope.id).eq("review_status", "approved")
    .order("created_at", { ascending: false }).limit(12);
  if (paymentError) return { state: "unavailable" };
  const { data: submission, error: submissionError } = await client.from("public_payment_submissions")
    .select("status, review_notes, rejection_reason").eq("public_access_token_id", context.token.id).maybeSingle();
  if (submissionError) return { state: "unavailable" };
  const approvedPayments = ((paymentRows ?? []) as Array<{ amount_minor: number | string; currency: string; created_at: string }>)
    .filter((payment) => payment.currency === context.caseScope.currency)
    .map((payment) => ({ amountMinor: String(payment.amount_minor), paidAt: payment.created_at }));
  const proofStatus: PublicPaymentDetails["proofStatus"] = submission ? (submission as { status: Exclude<PublicPaymentDetails["proofStatus"], "not_submitted"> }).status : "not_submitted";
  const proofReviewMessage = submission ? ((submission as { review_notes: string | null; rejection_reason: string | null }).rejection_reason ?? (submission as { review_notes: string | null }).review_notes) : null;
  const { data: planData, error: planError } = await client.from("payment_plans")
    .select("id, status").eq("case_id", context.caseScope.id).in("status", ["active", "defaulted"])
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (planError) return { state: "unavailable" };
  const activePlan = planData as { id: string; status: "active" | "defaulted" } | null;
  const { data: installmentData, error: installmentError } = activePlan
    ? await client.from("payment_plan_installments").select("sequence_no, due_date, amount_minor, paid_minor, status")
      .eq("payment_plan_id", activePlan.id).order("sequence_no")
    : { data: [], error: null };
  if (installmentError) return { state: "unavailable" };
  const installments = (installmentData ?? []) as Array<{ sequence_no: number; due_date: string; amount_minor: string; paid_minor: string; status: string }>;
  const nextInstallment = installments.find((item) => BigInt(item.paid_minor) < BigInt(item.amount_minor)) ?? null;
  const paymentPlanProgress: PublicPaymentDetails["paymentPlanProgress"] = activePlan ? {
    status: activePlan.status,
    paidMinor: installments.reduce((sum, item) => sum + BigInt(item.paid_minor), 0n).toString(),
    totalMinor: installments.reduce((sum, item) => sum + BigInt(item.amount_minor), 0n).toString(),
    paidInstallments: installments.filter((item) => BigInt(item.paid_minor) >= BigInt(item.amount_minor)).length,
    installmentCount: installments.length,
    nextInstallment: nextInstallment ? {
      sequence: nextInstallment.sequence_no, dueDate: nextInstallment.due_date,
      amountMinor: nextInstallment.amount_minor, paidMinor: nextInstallment.paid_minor, status: nextInstallment.status,
    } : null,
  } : null;
  const [{ data: recoveryData, error: recoveryError }, { data: linkData, error: linkError }, { data: activeDisputeData, error: disputeError }] = await Promise.all([
    client.from("case_recovery_amounts").select("total_outstanding_minor,active_disputed_minor,collectable_minor").eq("case_id", context.caseScope.id).maybeSingle(),
    client.from("recovery_case_obligations").select("obligation_id").eq("case_id", context.caseScope.id),
    client.from("disputes").select("status,disputed_amount_minor,undisputed_amount_minor,creditor_response")
      .eq("case_id", context.caseScope.id)
      .in("status", ["submitted", "under_review", "information_requested", "partially_accepted"])
      .order("submitted_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (recoveryError || linkError || disputeError) return { state: "unavailable" };
  const recovery = recoveryData as { total_outstanding_minor: number | string; active_disputed_minor: number | string; collectable_minor: number | string } | null;
  const obligationIds = ((linkData ?? []) as Array<{ obligation_id: string }>).map((link) => link.obligation_id);
  const { data: obligationData, error: obligationError } = obligationIds.length
    ? await client.from("obligations").select("id,reference,outstanding_minor").in("id", obligationIds).eq("business_id", context.caseScope.business_id).is("archived_at", null)
    : { data: [], error: null };
  if (obligationError) return { state: "unavailable" };
  const totalOutstanding = Number(recovery?.total_outstanding_minor ?? context.caseScope.outstanding_minor ?? 0);
  const collectableMinor = Number(recovery?.collectable_minor ?? totalOutstanding);
  const activeDispute = activeDisputeData as {
    status: string; disputed_amount_minor: number | string; undisputed_amount_minor: number | string; creditor_response: string | null;
  } | null;
  const dispute: PublicPaymentDetails["dispute"] = {
    active: activeDispute ? {
      status: activeDispute.status,
      disputedAmountMinor: String(activeDispute.disputed_amount_minor),
      undisputedAmountMinor: String(activeDispute.undisputed_amount_minor),
      creditorResponse: activeDispute.creditor_response,
    } : null,
    options: obligationIds.length
      ? ((obligationData ?? []) as Array<{ id: string; reference: string; outstanding_minor: number | string }>).map((item) => ({
        obligationId: item.id, reference: item.reference, balanceMinor: String(item.outstanding_minor),
      }))
      : [{ obligationId: null, reference: c.invoice_no ?? context.caseScope.id, balanceMinor: String(totalOutstanding) }],
  };
  const { data: negotiationData, error: negotiationError } = await client.from("payment_negotiations")
    .select("id,option_type,status,current_revision_no,expires_at")
    .eq("public_access_token_id", context.token.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (negotiationError) return { state: "unavailable" };
  const negotiationRow = negotiationData as {
    id: string; option_type: PublicPaymentDetails["negotiation"]["active"] extends infer T
      ? T extends { optionType: infer O } ? O : never : never;
    status: PublicPaymentDetails["negotiation"]["active"] extends infer T
      ? T extends { status: infer S } ? S : never : never;
    current_revision_no: number; expires_at: string;
  } | null;
  const { data: negotiationRevision, error: negotiationRevisionError } = negotiationRow
    ? await client.from("payment_negotiation_revisions")
      .select("proposed_by,amount_now_minor,installment_amount_minor,frequency,start_date,reason,note")
      .eq("negotiation_id", negotiationRow.id).eq("revision_no", negotiationRow.current_revision_no).maybeSingle()
    : { data: null, error: null };
  if (negotiationRevisionError) return { state: "unavailable" };
  const revision = negotiationRevision as {
    proposed_by: "debtor" | "creditor"; amount_now_minor: string; installment_amount_minor: string;
    frequency: "weekly" | "monthly"; start_date: string; reason: string | null; note: string | null;
  } | null;
  const negotiation: PublicPaymentDetails["negotiation"] = {
    active: negotiationRow && revision ? {
      id: negotiationRow.id, optionType: negotiationRow.option_type, status: negotiationRow.status,
      proposedBy: revision.proposed_by, amountNowMinor: String(revision.amount_now_minor),
      installmentAmountMinor: String(revision.installment_amount_minor),
      frequency: revision.frequency, startDate: revision.start_date, reason: revision.reason,
      note: revision.note, expiresAt: negotiationRow.expires_at,
    } : null,
  };
  const { data: onlineConnection, error: onlineError } = await client.from("business_payment_connections")
    .select("charges_enabled").eq("business_id", context.caseScope.business_id).is("disconnected_at", null).maybeSingle();
  // Online payment is optional: a lookup failure only hides the button.
  const onlinePayment = {
    available: !onlineError && Boolean((onlineConnection as { charges_enabled?: boolean } | null)?.charges_enabled) && collectableMinor >= 200,
  };
  const lockedDetails = (approvalRequired: boolean): PublicAccessResolution<PublicPaymentDetails> => ({
    state: "valid" as const,
    data: {
      creditor: {
        name: business.legal_name || business.business_name,
        phone: business.phone,
        email: business.email,
        verificationState: business.verification_state,
      },
      currency: context.caseScope.currency,
      invoiceReference: c.invoice_no,
      onlinePayment,
      amountDue: minorToMajorNumber(collectableMinor, context.caseScope.currency),
      totalOutstanding: minorToMajorNumber(totalOutstanding, context.caseScope.currency),
      collectableAmount: minorToMajorNumber(collectableMinor, context.caseScope.currency),
      dueDate: c.due_date,
      receivingAccount: null,
      accessRequired: true,
      approvalRequired,
      otp: { verified: false, sessionExpiresAt: null, channels: otpChannels },
      approvedPayments,
      proofStatus,
      proofReviewMessage,
      paymentPlanProgress,
      dispute,
      negotiation,
    },
  });
  if (c.payment_lock_mode === "approval") {
    if (!context.token.payment_access_request_id) return lockedDetails(true);
    const { data: request } = await client.from("payment_access_requests")
      .select("case_id, status, expires_at").eq("id", context.token.payment_access_request_id)
      .eq("case_id", context.caseScope.id).maybeSingle();
    const approval = request as { case_id: string; status: string; expires_at: string | null } | null;
    if (!approval || approval.case_id !== context.caseScope.id || approval.status === "pending") return lockedDetails(true);
    if (approval.status !== "approved" || (approval.expires_at && new Date(approval.expires_at) <= new Date())) return { state: "invalid" };
  }

  if (!rawSession) return lockedDetails(false);
  const { data: sessionData, error: sessionError } = await client.rpc("payment_access_validate_session", {
    p_token_id: context.token.id,
    p_session_hash: hashPaymentSession(rawSession),
  });
  if (sessionError) return { state: "unavailable" };
  const paymentSession = sessionData as { valid: boolean; session_id?: string; expires_at?: string };
  if (!paymentSession.valid || !paymentSession.session_id || !paymentSession.expires_at) return lockedDetails(false);

  const { data: accountData, error: accountError } = await client
    .from("receiving_accounts")
    .select("bank_name, payment_method, account_holder_name, account_number, duitnow_id, qr_object_path, is_active, verification_status, currency")
    .eq("id", context.token.receiving_account_id)
    .eq("business_id", context.caseScope.business_id)
    .maybeSingle();

  if (accountError) return { state: "unavailable" };

  // The view timestamp is operational metadata only; it is never exposed.
  await client
    .from("public_access_tokens")
    .update({ last_viewed_at: new Date().toISOString() })
    .eq("id", context.token.id)
    .eq("business_id", context.caseScope.business_id);

  const account = accountData as {
    bank_name: string;
    payment_method: string;
    account_holder_name: string;
    account_number: string;
    duitnow_id: string | null;
    is_active: boolean;
    verification_status: string;
    qr_object_path: string | null;
    currency: string;
  } | null;
  const usableAccount = account?.is_active && account.verification_status === "verified" && account.currency === context.caseScope.currency ? account : null;
  const qrUrl = usableAccount?.qr_object_path
    ? `/api/public/pay/${encodeURIComponent(rawToken)}?asset=qr`
    : null;

  return {
    state: "valid",
    data: {
      currency: context.caseScope.currency,
      invoiceReference: c.invoice_no,
      onlinePayment,
      amountDue: minorToMajorNumber(collectableMinor, context.caseScope.currency),
      totalOutstanding: minorToMajorNumber(totalOutstanding, context.caseScope.currency),
      collectableAmount: minorToMajorNumber(collectableMinor, context.caseScope.currency),
      dueDate: c.due_date,
      creditor: {
        name: business.legal_name || business.business_name,
        phone: business.phone,
        email: business.email,
        verificationState: business.verification_state,
      },
      accessRequired: false,
      approvalRequired: false,
      otp: { verified: true, sessionExpiresAt: paymentSession.expires_at, channels: otpChannels },
      approvedPayments,
      proofStatus,
      proofReviewMessage,
      paymentPlanProgress,
      dispute,
      negotiation,
      receivingAccount: usableAccount
        ? {
            bankName: usableAccount.bank_name,
            paymentMethod: usableAccount.payment_method,
            accountHolderName: usableAccount.account_holder_name,
            accountNumber: usableAccount.account_number,
            duitnowId: usableAccount.duitnow_id,
            qrUrl,
          }
        : null,
    },
  };
}

export async function resolvePublicAcknowledgement(
  rawToken: string,
): Promise<PublicAccessResolution<PublicAcknowledgementDetails>> {
  const context = await getPublicActionContext(rawToken, "acknowledgement");
  if (context.state !== "valid") return context;
  if (!context.token.payment_plan_id) return { state: "invalid" };
  if (context.caseScope.status === "closed" || context.caseScope.status === "paid" || context.caseScope.archived_at || Number(context.caseScope.outstanding_minor ?? 0) <= 0) return { state: "invalid" };

  const client = await getServiceClient();
  if (!client) return { state: "unavailable" };

  const { data, error } = await client
    .from("payment_plans")
    .select("case_id, status, terms_version, terms_snapshot")
    .eq("id", context.token.payment_plan_id)
    .eq("case_id", context.caseScope.id)
    .maybeSingle();

  if (error || !data) return { state: error ? "unavailable" : "invalid" };

  const plan = data as {
    case_id: string;
    status: string;
    terms_version: number;
    terms_snapshot: unknown;
  };
  if (plan.case_id !== context.caseScope.id || plan.status !== "pending_acceptance" || !plan.terms_snapshot || typeof plan.terms_snapshot !== "object") {
    return { state: "invalid" };
  }
  const terms = plan.terms_snapshot as {
    frequency?: unknown;
    total_minor?: unknown;
    schedule?: unknown;
    notes?: unknown;
  };
  if ((terms.frequency !== "weekly" && terms.frequency !== "monthly" && terms.frequency !== "custom") ||
    (typeof terms.total_minor !== "number" && typeof terms.total_minor !== "string") || !Array.isArray(terms.schedule)) {
    return { state: "invalid" };
  }
  const schedule = terms.schedule.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as { sequence?: unknown; due_date?: unknown; amount_minor?: unknown };
    if (typeof item.sequence !== "number" || !Number.isInteger(item.sequence) || typeof item.due_date !== "string" || (typeof item.amount_minor !== "number" && typeof item.amount_minor !== "string")) return [];
    return [{ sequence: item.sequence, dueDate: item.due_date, amountMinor: String(item.amount_minor) }];
  });
  if (schedule.length !== terms.schedule.length || schedule.length === 0) return { state: "invalid" };
  const { data: businessData, error: businessError } = await client.from("businesses")
    .select("business_name, legal_name, phone, email").eq("id", context.caseScope.business_id).maybeSingle();
  if (businessError || !businessData) return { state: businessError ? "unavailable" : "invalid" };
  const business = businessData as { business_name: string; legal_name: string | null; phone: string | null; email: string | null };

  await client
    .from("public_access_tokens")
    .update({ last_viewed_at: new Date().toISOString() })
    .eq("id", context.token.id)
    .eq("business_id", context.caseScope.business_id);

  return {
    state: "valid",
    data: {
      currency: context.caseScope.currency,
      termsVersion: plan.terms_version,
      creditorName: business.legal_name || business.business_name,
      creditorPhone: business.phone,
      creditorEmail: business.email,
      frequency: terms.frequency,
      totalMinor: String(terms.total_minor),
      schedule,
      notes: typeof terms.notes === "string" ? terms.notes : null,
    },
  };
}

export async function appendPublicAuditLog(input: {
  businessId: string;
  caseId: string;
  action: "payment_proof.submitted" | "payment_plan.acknowledged";
  tokenId: string;
  metadata: Record<string, string>;
}): Promise<void> {
  const client = await getServiceClient();
  if (!client) return;

  const { error } = await client.from("audit_logs").insert({
    business_id: input.businessId,
    case_id: input.caseId,
    action: input.action,
    actor_type: "debtor",
    actor_id: null,
    metadata: { token_id: input.tokenId, ...input.metadata },
  });

  if (error) {
    console.error("[public-access] audit write failed:", error.message);
  }
}

export async function getOwnedCaseScope(
  caseId: string,
  userId: string,
): Promise<CaseScope | null> {
  const client = await getServiceClient();
  if (!client) return null;

  const { data: caseData } = await client
    .from("cases")
    .select("id, business_id")
    .eq("id", caseId)
    .maybeSingle();
  if (!caseData) return null;

  const scope = caseData as CaseScope;
  const { data: business } = await client
    .from("businesses")
    .select("id")
    .eq("id", scope.business_id)
    .eq("owner_id", userId)
    .maybeSingle();

  return business ? scope : null;
}
