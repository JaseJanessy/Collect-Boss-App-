import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import { parseCurrencyToMinor } from "@/lib/financial/money";
import type { DisputeCategory, DisputeEvidenceRow, DisputeEventRow, DisputeRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";
const categories = new Set<DisputeCategory>([
  "amount_incorrect", "already_paid", "duplicate_invoice", "goods_not_received",
  "damaged_quality_issue", "service_incomplete", "incorrect_pricing", "do_not_recognise_debt", "other",
]);

async function ownedCase(caseId: string, write = false) {
  const auth = await getAuthenticatedBusiness(write ? "dispute.resolve" : "case.read");
  if ("error" in auth) return auth;
  const { data } = await auth.client.from("cases").select("id,currency")
    .eq("id", caseId).eq("business_id", auth.businessId).maybeSingle();
  return data ? { ...auth, caseCurrency: (data as { currency?: string }).currency ?? "MYR" } : { error: "Case not found." as const };
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const auth = await ownedCase(caseId);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.error === "Case not found." ? 404 : 401 });
  const [disputes, evidence, events, recovery] = await Promise.all([
    auth.client.from("disputes").select("*").eq("case_id", caseId).eq("business_id", auth.businessId).order("submitted_at", { ascending: false }),
    auth.client.from("dispute_evidence").select("*").eq("case_id", caseId).eq("business_id", auth.businessId).order("created_at"),
    auth.client.from("dispute_events").select("*").eq("case_id", caseId).eq("business_id", auth.businessId).order("created_at", { ascending: false }),
    auth.client.from("case_recovery_amounts").select("*").eq("case_id", caseId).eq("business_id", auth.businessId).maybeSingle(),
  ]);
  const error = disputes.error ?? evidence.error ?? events.error ?? recovery.error;
  if (error) return NextResponse.json({ error: "Unable to load disputes." }, { status: 503 });
  return NextResponse.json({
    disputes: disputes.data as DisputeRow[], evidence: evidence.data as DisputeEvidenceRow[],
    events: events.data as DisputeEventRow[], recovery: recovery.data,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const auth = await ownedCase(caseId, true);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.error === "Case not found." ? 404 : 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.category !== "string" || !categories.has(body.category as DisputeCategory)
    || typeof body.amount !== "string" || typeof body.reason !== "string" || !body.reason.trim()
    || typeof body.description !== "string" || body.description.trim().length < 5) {
    return NextResponse.json({ error: "Enter valid dispute details." }, { status: 400 });
  }
  let amountMinor: bigint;
  try { amountMinor = parseCurrencyToMinor(body.amount, "caseCurrency" in auth ? auth.caseCurrency : "MYR"); }
  catch { return NextResponse.json({ error: "Enter a valid disputed amount." }, { status: 400 }); }
  const { data, error } = await auth.client.rpc("dispute_create_owner", {
    p_case_id: caseId,
    p_obligation_id: typeof body.obligation_id === "string" ? body.obligation_id : null,
    p_category: body.category as DisputeCategory,
    p_disputed_amount_minor: amountMinor.toString(),
    p_reason: body.reason.trim().slice(0, 300),
    p_description: body.description.trim().slice(0, 2000),
    p_idempotency_key: typeof body.idempotency_key === "string" ? body.idempotency_key : crypto.randomUUID(),
  });
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Unable to create dispute." }, { status: 409 });
  return NextResponse.json({ dispute: data as DisputeRow }, { status: 201 });
}
