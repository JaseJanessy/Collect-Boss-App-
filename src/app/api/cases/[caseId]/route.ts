import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import { parseMyrToMinor } from "@/lib/financial/money";
import { casePatchSchema } from "@/lib/validations/case";
import type { AppSupabaseClient } from "@/lib/supabase/client";
import type { CaseRow, CaseUpdate } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

function validCaseId(caseId: string) {
  return caseId.length > 0 && caseId.length <= 100;
}

type FoundCase =
  | { client: AppSupabaseClient; businessId: string; caseData: CaseRow }
  | { error: string; notFound?: true };

async function authenticatedCase(caseId: string): Promise<FoundCase> {
  const auth = await getAuthenticatedBusiness();
  if ("error" in auth) return { error: auth.error ?? "Case service is unavailable." };

  const { data, error } = await auth.client
    .from("cases")
    .select("*")
    .eq("id", caseId)
    .eq("business_id", auth.businessId)
    .maybeSingle();

  if (error) return { error: "Unable to load case." };
  if (!data) return { error: "Case not found.", notFound: true };
  return { client: auth.client, businessId: auth.businessId, caseData: data as CaseRow };
}

function errorResponse(error: string, notFound?: boolean) {
  if (notFound) return NextResponse.json({ error }, { status: 404 });
  return NextResponse.json({ error }, { status: error === "You must be signed in." ? 401 : 503 });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  if (!validCaseId(caseId)) return NextResponse.json({ error: "Invalid case ID." }, { status: 400 });

  const found = await authenticatedCase(caseId);
  if (!("caseData" in found)) return errorResponse(found.error, found.notFound);
  return NextResponse.json({ case: found.caseData }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  if (!validCaseId(caseId)) return NextResponse.json({ error: "Invalid case ID." }, { status: 400 });
  const found = await authenticatedCase(caseId);
  if (!("caseData" in found)) return errorResponse(found.error, found.notFound);

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const methods = new Set(["duitnow_qr", "bank_transfer", "cash", "cheque", "tng_ewallet"]);
  if (!body || typeof body.amount !== "string" || typeof body.payment_method !== "string" || !methods.has(body.payment_method)) {
    return NextResponse.json({ error: "Invalid payment details." }, { status: 400 });
  }
  let amountMinor: bigint;
  try { amountMinor = parseMyrToMinor(body.amount); } catch (error) {
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

  const found = await authenticatedCase(caseId);
  if (!("caseData" in found)) return errorResponse(found.error, found.notFound);

  const parsed = casePatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid case update." }, { status: 400 });

  if (parsed.data.action === "status") {
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
    try { amountMinor = parseMyrToMinor(parsed.data.amount); } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid payment amount." }, { status: 400 });
    }
    const { error } = await found.client.rpc("financial_create_owner_payment", {
      p_case_id: caseId, p_amount_minor: amountMinor.toString(), p_payment_method: "cash",
      p_reference_no: null, p_proof_url: null, p_notes: null, p_approve: true,
    });
    if (error) return NextResponse.json({ error: error.message ?? "Unable to record payment." }, { status: 409 });
    const { data: updated, error: reloadError } = await found.client.from("cases").select("*").eq("id", caseId).maybeSingle();
    if (reloadError || !updated) return NextResponse.json({ error: "Payment recorded but the case could not be reloaded." }, { status: 500 });
    return NextResponse.json({ case: updated as CaseRow });
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
  return NextResponse.json({ case: data as CaseRow });
}
