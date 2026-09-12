import "server-only";

import type { AppSupabaseClient } from "@/lib/supabase/client";
import type {
  ComplianceCaseHoldRow,
  CompliancePolicyCheckRow,
  CompliancePolicyVersionRow,
  ContactPreferenceRow,
  Json,
} from "@/lib/supabase/types";
import { loadContactGuardContexts } from "@/lib/communications/guard-server";
import { approvalSatisfies, evaluateCompliancePolicy, hashComplianceContent } from "./policy-engine";
import type {
  ComplianceApprovalLevel,
  ComplianceEvaluation,
  CompliancePolicyRules,
  CompliancePolicyVersion,
  SensitiveCaseCategory,
} from "./types";

export class ComplianceGateError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly check?: CompliancePolicyCheckRow,
  ) { super(message); }
}

export interface ComplianceProposal {
  businessId: string;
  caseId: string;
  actorId: string | null;
  jurisdiction: string;
  actionKind: CompliancePolicyCheckRow["action_kind"];
  channel: NonNullable<CompliancePolicyCheckRow["channel"]>;
  subject?: string | null;
  bodyText?: string | null;
  recipients?: string[];
  requestedAmountMinor?: number | null;
  bulk?: boolean;
  evaluateAt?: Date;
  expiresAt?: Date;
}

function asPolicy(row: CompliancePolicyVersionRow): CompliancePolicyVersion {
  return { ...row, rules: row.rules as unknown as CompliancePolicyRules };
}

export async function loadActiveCompliancePolicy(
  client: AppSupabaseClient,
  businessId: string,
  jurisdiction: string,
  at = new Date(),
) {
  const iso = at.toISOString();
  const { data, error } = await client.from("compliance_policy_versions").select("*")
    .eq("jurisdiction", jurisdiction.toUpperCase())
    .eq("status", "counsel_approved")
    .lte("effective_from", iso)
    .or(`effective_until.is.null,effective_until.gt.${iso}`)
    .or(`scope_business_id.is.null,scope_business_id.eq.${businessId}`)
    .order("scope_business_id", { ascending: false, nullsFirst: false })
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new ComplianceGateError("Compliance policy lookup failed.", 503, "POLICY_LOOKUP_FAILED");
  if (!data) {
    throw new ComplianceGateError(
      `Outbound execution is paused because no counsel-approved ${jurisdiction.toUpperCase()} policy is active.`,
      409,
      "NO_ACTIVE_COUNSEL_APPROVED_POLICY",
    );
  }
  return asPolicy(data as CompliancePolicyVersionRow);
}

export async function createSensitiveCaseHolds(
  client: AppSupabaseClient,
  input: ComplianceProposal,
  checkId: string | null,
  categories: SensitiveCaseCategory[],
  warnings: string[],
) {
  if (!categories.length) return;
  const { data: business } = await client.from("businesses").select("owner_id").eq("id", input.businessId).maybeSingle();
  if (!business?.owner_id) throw new ComplianceGateError("Sensitive-case review owner is unavailable.", 503, "REVIEW_OWNER_UNAVAILABLE");
  for (const category of categories) {
    const { data: existing } = await client.from("compliance_case_holds").select("*")
      .eq("business_id", input.businessId).eq("case_id", input.caseId).eq("category", category).eq("status", "active").maybeSingle();
    if (existing) continue;
    const holdId = crypto.randomUUID();
    const detail = warnings.join(" ").slice(0, 1000) || `Sensitive case trigger: ${category}.`;
    const { data: hold, error } = await client.from("compliance_case_holds").insert({
      id: holdId,
      business_id: input.businessId,
      case_id: input.caseId,
      category,
      source_check_id: checkId,
      status: "active",
      detail,
      owner_id: business.owner_id,
      created_by: input.actorId,
    }).select("*").single();
    if (error || !hold) throw new ComplianceGateError("Sensitive-case hold could not be created.", 503, "HOLD_CREATE_FAILED");
    const { data: action, error: actionError } = await client.from("action_centre_items").insert({
      business_id: input.businessId,
      case_id: input.caseId,
      customer_id: null,
      assignee_id: business.owner_id,
      type: "compliance.sensitive_review",
      title: "Review paused sensitive case",
      description: detail,
      reason: `Sensitive case: ${category}`,
      amount_minor: 0,
      priority: "critical",
      recommended_action: "Review the case, document the outcome, and resolve the hold before communication resumes.",
      href: `/cases/${encodeURIComponent(input.caseId)}`,
      entity_type: "compliance_case_hold",
      entity_id: holdId,
      status: "open",
      completed_at: null,
      snoozed_until: null,
      dedupe_key: `compliance-hold:${holdId}`,
    } as never).select("id").single();
    if (actionError || !action) throw new ComplianceGateError("Sensitive-case review task could not be created.", 503, "REVIEW_TASK_CREATE_FAILED");
    await client.from("compliance_case_holds").update({ action_item_id: action.id }).eq("id", hold.id);
  }
}

export async function createComplianceCheck(client: AppSupabaseClient, input: ComplianceProposal) {
  const evaluatedAt = input.evaluateAt ?? new Date();
  const policy = await loadActiveCompliancePolicy(client, input.businessId, input.jurisdiction, evaluatedAt);
  const [{ data: caseData, error: caseError }, contexts, { data: holds, error: holdError }] = await Promise.all([
    client.from("cases").select("id,confirmed_outstanding_minor,unverified_balance_minor")
      .eq("business_id", input.businessId).eq("id", input.caseId).maybeSingle(),
    loadContactGuardContexts(client, [input.caseId]),
    client.from("compliance_case_holds").select("category").eq("business_id", input.businessId)
      .eq("case_id", input.caseId).eq("status", "active"),
  ]);
  if (caseError || !caseData) throw new ComplianceGateError("Case is unavailable for compliance review.", 404, "CASE_NOT_FOUND");
  const context = contexts.contexts.get(input.caseId);
  if (contexts.error || !context || holdError) throw new ComplianceGateError("Compliance context is unavailable.", 503, "CONTEXT_UNAVAILABLE");
  const evaluation = evaluateCompliancePolicy(policy, {
    caseId: input.caseId,
    channel: input.channel,
    subject: input.subject,
    bodyText: input.bodyText,
    recipients: input.recipients,
    timezone: context.timezone,
    now: evaluatedAt,
    counts: context.counts,
    preferences: context.preferences as ContactPreferenceRow | null,
    confirmedOutstandingMinor: Number(caseData.confirmed_outstanding_minor ?? 0),
    unverifiedBalanceMinor: Number(caseData.unverified_balance_minor ?? 0),
    requestedAmountMinor: input.requestedAmountMinor,
    bulk: input.bulk,
    activeSensitiveCategories: (holds ?? []).map((hold) => hold.category as SensitiveCaseCategory),
  });
  const contentHash = hashComplianceContent({
    caseId: input.caseId,
    channel: input.channel,
    subject: input.subject,
    bodyText: input.bodyText,
    recipients: input.recipients,
  });
  const automatic = evaluation.required_approval === "automatic";
  const expiresAt = input.expiresAt ?? new Date(evaluatedAt.getTime() + 24 * 60 * 60 * 1000);
  const { data, error } = await client.from("compliance_policy_checks").insert({
    business_id: input.businessId,
    case_id: input.caseId,
    policy_version_id: policy.id,
    action_kind: input.actionKind,
    channel: input.channel,
    content_hash: contentHash,
    result: evaluation.result,
    required_approval: evaluation.required_approval,
    warnings: evaluation.warnings as Json,
    signals: evaluation.signals as Json,
    approval_state: automatic ? "approved" : evaluation.result === "prohibited" ? "prohibited" : "pending",
    requested_by: input.actorId,
    approved_by: automatic ? input.actorId : null,
    approved_at: automatic ? evaluatedAt.toISOString() : null,
    approval_note: automatic ? "Automatically approved as low risk by the active policy." : null,
    expires_at: expiresAt.toISOString(),
  }).select("*").single();
  if (error || !data) throw new ComplianceGateError("Compliance decision could not be recorded.", 503, "CHECK_CREATE_FAILED");
  const check = data as CompliancePolicyCheckRow;
  try {
    await createSensitiveCaseHolds(client, input, check.id, evaluation.sensitive_case_triggers, evaluation.warnings);
    const { error: auditError } = await client.from("audit_logs").insert({
      business_id: input.businessId,
      case_id: input.caseId,
      action: "compliance.checked",
      actor_type: input.actorId ? "staff" : "system",
      actor_id: input.actorId,
      entity_type: "compliance_policy_check",
      entity_id: check.id,
      metadata: {
        policy_version_id: policy.id,
        policy_version: policy.version,
        result: evaluation.result,
        warnings: evaluation.warnings,
        required_approval: evaluation.required_approval,
        approver: check.approved_by,
        final_action: check.final_action,
      },
    });
    if (auditError) throw auditError;
  } catch (error) {
    await client.from("compliance_policy_checks").update({
      approval_state: "invalidated", invalidated_at: new Date().toISOString(), final_action: "audit_failed",
    }).eq("id", check.id);
    if (error instanceof ComplianceGateError) throw error;
    throw new ComplianceGateError("Compliance auditing failed; execution remains blocked.", 503, "AUDIT_FAILED");
  }
  return { check, evaluation, contentHash, policy };
}

export async function requireExecutableComplianceCheck(
  client: AppSupabaseClient,
  input: ComplianceProposal,
  checkId?: string | null,
) {
  if (!checkId) {
    const created = await createComplianceCheck(client, input);
    if (created.check.approval_state !== "approved") {
      throw new ComplianceGateError(
        created.check.approval_state === "prohibited" ? "The proposed action is prohibited by the active policy." : `The proposed action requires ${created.check.required_approval} approval.`,
        409,
        created.check.approval_state === "prohibited" ? "ACTION_PROHIBITED" : "APPROVAL_REQUIRED",
        created.check,
      );
    }
    return created;
  }
  const { data, error } = await client.from("compliance_policy_checks").select("*")
    .eq("id", checkId).eq("business_id", input.businessId).eq("case_id", input.caseId).maybeSingle();
  if (error || !data) throw new ComplianceGateError("Compliance check was not found.", 404, "CHECK_NOT_FOUND");
  const check = data as CompliancePolicyCheckRow;
  const contentHash = hashComplianceContent({ caseId: input.caseId, channel: input.channel, subject: input.subject, bodyText: input.bodyText, recipients: input.recipients });
  if (check.content_hash !== contentHash) {
    await client.from("compliance_policy_checks").update({
      approval_state: "invalidated", invalidated_at: new Date().toISOString(), final_action: "content_changed",
    }).eq("id", check.id).eq("approval_state", check.approval_state);
    await client.from("audit_logs").insert({
      business_id: input.businessId, case_id: input.caseId, action: "compliance.approval_invalidated",
      actor_type: input.actorId ? "staff" : "system", actor_id: input.actorId,
      entity_type: "compliance_policy_check", entity_id: check.id,
      metadata: { policy_version_id: check.policy_version_id, result: check.result, warnings: check.warnings, approver: check.approved_by, final_action: "content_changed" },
    });
    throw new ComplianceGateError("Message content changed after review; a new compliance check is required.", 409, "APPROVAL_INVALIDATED", check);
  }
  if (check.approval_state !== "approved" || check.result === "prohibited" || new Date(check.expires_at) <= new Date()) {
    throw new ComplianceGateError("The required compliance decision has not been granted or has expired.", 409, "APPROVAL_REQUIRED", check);
  }
  const { count } = await client.from("compliance_case_holds").select("id", { count: "exact", head: true })
    .eq("business_id", input.businessId).eq("case_id", input.caseId).eq("status", "active");
  if ((count ?? 0) > 0) throw new ComplianceGateError("Standard automation is paused while this sensitive case is under review.", 409, "CASE_AUTOMATION_PAUSED", check);
  return { check, evaluation: null, contentHash, policy: null };
}

export async function decideComplianceCheck(client: AppSupabaseClient, input: {
  businessId: string;
  checkId: string;
  actorId: string;
  actorApprovalLevel: ComplianceApprovalLevel;
  decision: "approve" | "reject" | "bypass";
  note: string;
}) {
  const { data } = await client.from("compliance_policy_checks").select("*")
    .eq("id", input.checkId).eq("business_id", input.businessId).maybeSingle();
  if (!data) throw new ComplianceGateError("Compliance check was not found.", 404, "CHECK_NOT_FOUND");
  const check = data as CompliancePolicyCheckRow;
  if (check.approval_state !== "pending") throw new ComplianceGateError("This compliance check is no longer pending.", 409, "CHECK_NOT_PENDING", check);
  if (input.decision === "approve" && !approvalSatisfies(check.required_approval, input.actorApprovalLevel)) {
    throw new ComplianceGateError("Your approval level does not satisfy this decision.", 403, "INSUFFICIENT_APPROVAL", check);
  }
  if (input.decision === "bypass" && check.required_approval === "prohibited") {
    throw new ComplianceGateError("Prohibited actions cannot be bypassed.", 409, "PROHIBITED_BYPASS_DENIED", check);
  }
  const now = new Date().toISOString();
  const approved = input.decision !== "reject";
  const { data: updated, error } = await client.from("compliance_policy_checks").update({
    approval_state: approved ? "approved" : "rejected",
    approved_by: approved ? input.actorId : null,
    approved_at: approved ? now : null,
    approval_note: input.note,
    bypassed: input.decision === "bypass",
    bypass_reason: input.decision === "bypass" ? input.note : null,
    final_action: input.decision === "reject" ? "rejected" : input.decision === "bypass" ? "bypassed_pending_execution" : "approved_pending_execution",
    updated_at: now,
  }).eq("id", check.id).eq("approval_state", "pending").select("*").single();
  if (error || !updated) throw new ComplianceGateError("Compliance decision could not be saved.", 409, "DECISION_FAILED", check);
  const decided = updated as CompliancePolicyCheckRow;
  const { error: auditError } = await client.from("audit_logs").insert({
    business_id: input.businessId, case_id: check.case_id,
    action: input.decision === "bypass" ? "compliance.bypassed" : `compliance.${input.decision}d`,
    actor_type: "staff", actor_id: input.actorId,
    entity_type: "compliance_policy_check", entity_id: check.id,
    metadata: { policy_version_id: check.policy_version_id, result: check.result, warnings: check.warnings, approver: input.actorId, final_action: decided.final_action, reason: input.note },
  });
  if (auditError) {
    await client.from("compliance_policy_checks").update({ approval_state: "invalidated", invalidated_at: now, final_action: "audit_failed" }).eq("id", check.id);
    throw new ComplianceGateError("Decision auditing failed; execution remains blocked.", 503, "AUDIT_FAILED", decided);
  }
  return decided;
}

export function evaluationResponse(error: ComplianceGateError): Record<string, unknown> {
  return { error: error.message, code: error.code, check: error.check ?? undefined };
}

export function evaluationAuditSnapshot(evaluation: ComplianceEvaluation): Json {
  return JSON.parse(JSON.stringify(evaluation)) as Json;
}
