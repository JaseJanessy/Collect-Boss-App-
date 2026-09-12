import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import { parseCurrencyToMinor } from "@/lib/financial/money";
import { normalizeLegacyCaseRow } from "@/lib/receivables/legacy-normalization";
import { casePatchSchema } from "@/lib/validations/case";
import type { AppSupabaseClient } from "@/lib/supabase/client";
import type {
  CaseClosureReason,
  CaseRow,
  CaseUpdate,
  FinancialAdjustmentDirection,
  FinancialAdjustmentEventRow,
  FinancialAdjustmentRow,
  FinancialAdjustmentType,
} from "@/lib/supabase/types";
import type { TenantPermission } from "@/lib/auth/permissions";
import { canTransitionCase } from "@/lib/domain/workflows";
import { buildCasePrioritySummary } from "@/lib/cases/priority-summary-server";

export const dynamic = "force-dynamic";

function validCaseId(caseId: string) {
  return caseId.length > 0 && caseId.length <= 100;
}

type FoundCase =
  | { client: AppSupabaseClient; businessId: string; caseData: CaseRow }
  | { error: string; notFound?: true };

async function authenticatedCase(caseId: string, permission: TenantPermission = "case.read"): Promise<FoundCase> {
  const auth = await getAuthenticatedBusiness(permission);
  if ("error" in auth) return { error: auth.error ?? "Case service is unavailable." };

  const { data, error } = await auth.client
    .from("cases")
    .select("*")
    .eq("id", caseId)
    .eq("business_id", auth.businessId)
    .maybeSingle();

  if (error) return { error: "Unable to load case." };
  if (!data) return { error: "Case not found.", notFound: true };
  return {
    client: auth.client,
    businessId: auth.businessId,
    caseData: normalizeLegacyCaseRow(data as CaseRow),
  };
}

function errorResponse(error: string, notFound?: boolean) {
  if (notFound) return NextResponse.json({ error }, { status: 404 });
  return NextResponse.json({ error }, { status: error === "You must be signed in." ? 401 : 503 });
}

function parseNonNegativeMoney(value: unknown, currency: string): bigint {
  if (value === "0" || value === "0.0" || value === "0.00" || value === "") return 0n;
  if (typeof value !== "string") throw new Error("Enter a valid amount.");
  return parseCurrencyToMinor(value, currency);
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  if (!validCaseId(caseId)) return NextResponse.json({ error: "Invalid case ID." }, { status: 400 });

  const found = await authenticatedCase(caseId);
  if (!("caseData" in found)) return errorResponse(found.error, found.notFound);
  const adjustmentsResult = await found.client.from("financial_adjustments").select("*")
    .eq("case_id", caseId).eq("business_id", found.businessId).order("created_at", { ascending: false });
  if (adjustmentsResult.error) return NextResponse.json({ error: "Unable to load financial adjustments." }, { status: 503 });
  const adjustments = (adjustmentsResult.data ?? []) as FinancialAdjustmentRow[];
  const adjustmentIds = adjustments.map((item) => item.id);
  const eventsResult = adjustmentIds.length
    ? await found.client.from("financial_adjustment_events").select("*").in("adjustment_id", adjustmentIds).order("created_at", { ascending: false })
    : { data: [] as FinancialAdjustmentEventRow[], error: null };
  if (eventsResult.error) return NextResponse.json({ error: "Unable to load adjustment audit history." }, { status: 503 });
  let prioritySummary;
  try {
    prioritySummary = await buildCasePrioritySummary(found.client, found.businessId, found.caseData);
  } catch {
    return NextResponse.json({ error: "Unable to reconcile the case priority summary." }, { status: 503 });
  }
  return NextResponse.json({
    case: found.caseData,
    adjustments,
    adjustmentEvents: (eventsResult.data ?? []) as FinancialAdjustmentEventRow[],
    prioritySummary,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  if (!validCaseId(caseId)) return NextResponse.json({ error: "Invalid case ID." }, { status: 400 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid case financial request." }, { status: 400 });
  const requiredPermission: TenantPermission =
    body.action === "review_write_off" ? "write_off.approve"
      : body.action === "settlement" ? "settlement.approve"
        : body.action === "close" || body.action === "adjustment" ? "case.manage"
          : body.review_status === "approved" ? "payment.approve" : "case.manage";
  const found = await authenticatedCase(caseId, requiredPermission);
  if (!("caseData" in found)) return errorResponse(found.error, found.notFound);
  if (body.action === "adjustment") {
    const adjustmentTypes = new Set<FinancialAdjustmentType>([
      "credit_note", "settlement_adjustment", "write_off", "manual_correction",
      "returned_goods", "commercial_discount", "other",
    ]);
    if (typeof body.adjustmentType !== "string" || !adjustmentTypes.has(body.adjustmentType as FinancialAdjustmentType)
      || (body.direction !== "credit" && body.direction !== "debit")
      || typeof body.reason !== "string" || !body.reason.trim()) {
      return NextResponse.json({ error: "Enter valid adjustment details and a reason." }, { status: 400 });
    }
    let amountMinor: bigint;
    let newAmountMinor: bigint | null = null;
    try {
      amountMinor = body.adjustmentType === "manual_correction" ? 1n : parseCurrencyToMinor(String(body.amount ?? ""), found.caseData.currency ?? "MYR");
      newAmountMinor = body.adjustmentType === "manual_correction" ? parseNonNegativeMoney(body.newAmount, found.caseData.currency ?? "MYR") : null;
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid adjustment amount." }, { status: 400 });
    }
    const { data, error } = await found.client.rpc("financial_create_adjustment", {
      p_case_id: caseId,
      p_obligation_id: typeof body.obligationId === "string" && body.obligationId ? body.obligationId : null,
      p_adjustment_type: body.adjustmentType as FinancialAdjustmentType,
      p_direction: body.direction as FinancialAdjustmentDirection,
      p_amount_minor: amountMinor.toString(),
      p_new_amount_minor: newAmountMinor?.toString() ?? null,
      p_reason: body.reason.trim().slice(0, 1000),
      p_reference: typeof body.reference === "string" ? body.reference.trim().slice(0, 160) || null : null,
      p_idempotency_key: typeof body.idempotencyKey === "string" ? body.idempotencyKey : crypto.randomUUID(),
    });
    if (error || !data) return NextResponse.json({ error: error?.message ?? "Unable to create adjustment." }, { status: 409 });
    return NextResponse.json({ adjustment: data as FinancialAdjustmentRow }, { status: 201 });
  }
  if (body.action === "review_write_off") {
    if (typeof body.adjustmentId !== "string" || (body.decision !== "approved" && body.decision !== "rejected")) {
      return NextResponse.json({ error: "Invalid write-off review." }, { status: 400 });
    }
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 1000) : "";
    if (body.decision === "rejected" && !reason) {
      return NextResponse.json({ error: "A rejection reason is required." }, { status: 400 });
    }
    const { data, error } = await found.client.rpc("financial_review_write_off", {
      p_adjustment_id: body.adjustmentId, p_decision: body.decision, p_reason: reason || null,
    });
    if (error || !data) return NextResponse.json({ error: error?.message ?? "Unable to review write-off." }, { status: 409 });
    return NextResponse.json({ adjustment: data as FinancialAdjustmentRow });
  }
  if (body.action === "settlement") {
    if (typeof body.reason !== "string" || !body.reason.trim()
      || typeof body.paymentMethod !== "string") {
      return NextResponse.json({ error: "Enter valid settlement details." }, { status: 400 });
    }
    let cashMinor: bigint;
    try { cashMinor = parseNonNegativeMoney(body.cashAmount, found.caseData.currency ?? "MYR"); } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid settlement cash amount." }, { status: 400 });
    }
    const { data, error } = await found.client.rpc("financial_settle_case", {
      p_case_id: caseId, p_payment_minor: cashMinor.toString(),
      p_payment_method: body.paymentMethod as import("@/lib/supabase/types").PaymentMethod,
      p_reference_no: typeof body.reference === "string" ? body.reference.trim().slice(0, 160) || null : null,
      p_reason: body.reason.trim().slice(0, 1000),
      p_idempotency_key: typeof body.idempotencyKey === "string" ? body.idempotencyKey : crypto.randomUUID(),
    });
    if (error || !data) return NextResponse.json({ error: error?.message ?? "Unable to settle case." }, { status: 409 });
    return NextResponse.json({ settlement: data }, { status: 201 });
  }
  if (body.action === "close") {
    const reasons = new Set<CaseClosureReason>([
      "paid_in_full", "settled", "written_off", "dispute_resolved",
      "cancelled", "duplicate", "professional_handoff", "other",
    ]);
    if (typeof body.reasonCode !== "string" || !reasons.has(body.reasonCode as CaseClosureReason)) {
      return NextResponse.json({ error: "Choose a valid closure reason." }, { status: 400 });
    }
    const { data, error } = await found.client.rpc("financial_close_case", {
      p_case_id: caseId, p_reason_code: body.reasonCode as CaseClosureReason,
      p_note: typeof body.note === "string" ? body.note.trim().slice(0, 1000) || null : null,
      p_expected_version: typeof body.expectedVersion === "number" ? body.expectedVersion : found.caseData.status_version,
    });
    if (error || !data) return NextResponse.json({ error: error?.message ?? "Unable to close case." }, { status: 409 });
    return NextResponse.json({ case: data as CaseRow });
  }
  const methods = new Set(["duitnow_qr", "bank_transfer", "cash", "cheque", "tng_ewallet"]);
  if (typeof body.amount !== "string" || typeof body.payment_method !== "string" || !methods.has(body.payment_method)) {
    return NextResponse.json({ error: "Invalid payment details." }, { status: 400 });
  }
  let amountMinor: bigint;
  try { amountMinor = parseCurrencyToMinor(body.amount, found.caseData.currency ?? "MYR"); } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid payment amount." }, { status: 400 });
  }
  const { data, error } = await found.client.rpc("financial_create_owner_payment", {
    p_case_id: caseId,
    p_amount_minor: amountMinor.toString(),
    p_payment_method: body.payment_method,
    p_reference_no: typeof body.reference_no === "string" ? body.reference_no.slice(0, 160) : null,
    p_proof_url: typeof body.proof_url === "string" ? body.proof_url : null,
    p_notes: typeof body.notes === "string" ? body.notes.slice(0, 500) : null,
    p_approve: body.review_status === "approved",
  });
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Unable to record payment." }, { status: 409 });
  return NextResponse.json({ payment: data as import("@/lib/supabase/types").PaymentRow }, { status: 201 });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  if (!validCaseId(caseId)) return NextResponse.json({ error: "Invalid case ID." }, { status: 400 });

  const found = await authenticatedCase(caseId, "case.manage");
  if (!("caseData" in found)) return errorResponse(found.error, found.notFound);

  const parsed = casePatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid case update." }, { status: 400 });

  if (parsed.data.action === "status") {
    if (!canTransitionCase(found.caseData.status, parsed.data.status)) {
      return NextResponse.json({
        error: `Case status cannot move from ${found.caseData.status} to ${parsed.data.status}.`,
      }, { status: 409 });
    }
    const { data, error } = await found.client.rpc("transition_case_status", {
      p_case_id: caseId,
      p_to_status: parsed.data.status,
      p_reason: parsed.data.reason?.trim() || null,
      p_promise_due_date: parsed.data.promise_due_date ?? null,
      p_expected_version: parsed.data.expected_version ?? found.caseData.status_version,
    });
    if (error || !data) return NextResponse.json({ error: error?.message ?? "Unable to transition case." }, { status: 409 });
    return NextResponse.json({ case: data as CaseRow });
  }

  if (parsed.data.action === "archive") {
    const { data, error } = await found.client.rpc("archive_closed_case", {
      p_case_id: caseId,
      p_reason: parsed.data.reason?.trim() || null,
      p_expected_version: parsed.data.expected_version ?? found.caseData.status_version,
    });
    if (error || !data) return NextResponse.json({ error: error?.message ?? "Unable to archive case." }, { status: 409 });
    return NextResponse.json({ case: data as CaseRow });
  }

  let patch: CaseUpdate;
  if (parsed.data.action === "next_action") {
    patch = { next_best_action: parsed.data.next_best_action?.trim() || null };
  } else if (parsed.data.action === "payment_lock_mode") {
    patch = { payment_lock_mode: parsed.data.payment_lock_mode };
  } else {
    let amountMinor: bigint;
    try { amountMinor = parseCurrencyToMinor(parsed.data.amount, found.caseData.currency ?? "MYR"); } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid payment amount." }, { status: 400 });
    }
    const { error } = await found.client.rpc("financial_create_owner_payment", {
      p_case_id: caseId, p_amount_minor: amountMinor.toString(), p_payment_method: "cash",
      p_reference_no: null, p_proof_url: null, p_notes: null, p_approve: true,
    });
    if (error) return NextResponse.json({ error: error.message ?? "Unable to record payment." }, { status: 409 });
    const { data: updated, error: reloadError } = await found.client.from("cases").select("*").eq("id", caseId).maybeSingle();
    if (reloadError || !updated) return NextResponse.json({ error: "Payment recorded but the case could not be reloaded." }, { status: 500 });
    return NextResponse.json({ case: normalizeLegacyCaseRow(updated as CaseRow) });
  }

  const { data, error } = await found.client
    .from("cases")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", caseId)
    .eq("business_id", found.businessId)
    .select("*")
    .maybeSingle();

  if (error) return NextResponse.json({ error: "Unable to update case." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Case not found." }, { status: 404 });
  return NextResponse.json({ case: normalizeLegacyCaseRow(data as CaseRow) });
}
