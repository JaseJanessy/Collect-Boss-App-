import "server-only";

import { getServiceClient } from "@/lib/supabase/service-client";
import { hashPublicToken } from "./token";
export { generatePublicToken, hashPublicToken, redactPublicToken } from "./token";
import type {
  PublicAccessResolution,
  PublicAcknowledgementDetails,
  PublicPaymentDetails,
} from "./types";

export type PublicAccessPurpose = "payment" | "acknowledgement";

interface TokenRow {
  id: string;
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
    .select("id, purpose, case_id, payment_plan_id, payment_access_request_id, receiving_account_id, expires_at, revoked_at, consumed_at")
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
    .select("id, business_id, status, archived_at, outstanding_minor")
    .eq("id", token.case_id)
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
): Promise<PublicAccessResolution<PublicPaymentDetails>> {
  const context = await getPublicActionContext(rawToken, "payment");
  if (context.state !== "valid") return context;

  const client = await getServiceClient();
  if (!client) return { state: "unavailable" };

  const { data: caseData, error: caseError } = await client
    .from("cases")
    .select("balance, amount_owed, due_date, invoice_no, status, archived_at, payment_lock_mode")
    .eq("id", context.caseScope.id)
    .maybeSingle();

  if (caseError || !caseData) return { state: caseError ? "unavailable" : "invalid" };

  const c = caseData as {
    balance: number | string | null; amount_owed: number | string | null; due_date: string | null; invoice_no: string | null;
    status: string; archived_at: string | null; payment_lock_mode: "immediate" | "approval" | "manual";
  };
  if (c.status === "closed" || c.status === "paid" || c.archived_at || !context.token.receiving_account_id || c.payment_lock_mode === "manual") return { state: "invalid" };
  const { data: businessData, error: businessError } = await client.from("businesses")
    .select("business_name, legal_name, phone, email").eq("id", context.caseScope.business_id).maybeSingle();
  if (businessError || !businessData) return { state: businessError ? "unavailable" : "invalid" };
  const business = businessData as { business_name: string; legal_name: string | null; phone: string | null; email: string | null };
  const { data: paymentRows, error: paymentError } = await client.from("payments")
    .select("amount, created_at").eq("case_id", context.caseScope.id).eq("review_status", "approved")
    .order("created_at", { ascending: false }).limit(12);
  if (paymentError) return { state: "unavailable" };
  const { data: submission, error: submissionError } = await client.from("public_payment_submissions")
    .select("status").eq("public_access_token_id", context.token.id).maybeSingle();
  if (submissionError) return { state: "unavailable" };
  const approvedPayments = ((paymentRows ?? []) as Array<{ amount: number | string; created_at: string }>)
    .map((payment) => ({ amountMinor: String(Math.round(Number(payment.amount) * 100)), paidAt: payment.created_at }));
  const proofStatus: PublicPaymentDetails["proofStatus"] = submission ? (submission as { status: "pending_review" | "approved" | "rejected" }).status : "not_submitted";
  const lockedDetails = {
    state: "valid" as const,
    data: { creditor: { name: business.legal_name || business.business_name, phone: business.phone, email: business.email }, invoiceReference: c.invoice_no, amountDue: Number(c.balance ?? c.amount_owed ?? 0), dueDate: c.due_date, receivingAccount: null, accessRequired: true, approvedPayments, proofStatus },
  };
  if (c.payment_lock_mode === "approval") {
    if (!context.token.payment_access_request_id) return lockedDetails;
    const { data: request } = await client.from("payment_access_requests")
      .select("case_id, status, expires_at").eq("id", context.token.payment_access_request_id).maybeSingle();
    const approval = request as { case_id: string; status: string; expires_at: string | null } | null;
    if (!approval || approval.case_id !== context.caseScope.id || approval.status === "pending") return lockedDetails;
    if (approval.status !== "approved" || (approval.expires_at && new Date(approval.expires_at) <= new Date())) return { state: "invalid" };
  }

  const { data: accountData, error: accountError } = await client
    .from("receiving_accounts")
    .select("bank_name, account_holder_name, account_number, duitnow_id")
    .eq("id", context.token.receiving_account_id)
    .eq("business_id", context.caseScope.business_id)
    .maybeSingle();

  if (accountError) return { state: "unavailable" };

  // The view timestamp is operational metadata only; it is never exposed.
  await client
    .from("public_access_tokens")
    .update({ last_viewed_at: new Date().toISOString() })
    .eq("id", context.token.id);

  const account = accountData as {
    bank_name: string;
    account_holder_name: string;
    account_number: string;
    duitnow_id: string | null;
  } | null;

  return {
    state: "valid",
    data: {
      invoiceReference: c.invoice_no,
      amountDue: Number(c.balance ?? c.amount_owed ?? 0),
      dueDate: c.due_date,
      creditor: { name: business.legal_name || business.business_name, phone: business.phone, email: business.email },
      accessRequired: false,
      approvedPayments,
      proofStatus,
      receivingAccount: account
        ? {
            bankName: account.bank_name,
            accountHolderName: account.account_holder_name,
            accountNumber: account.account_number,
            duitnowId: account.duitnow_id,
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
    .eq("id", context.token.id);

  return {
    state: "valid",
    data: {
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
