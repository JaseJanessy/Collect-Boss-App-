import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import { parseCurrencyToMinor } from "@/lib/financial/money";
import type {
  PaymentPromiseAllocationRow, PaymentPromiseEventRow, PaymentPromiseRow,
  PaymentPromiseSource, PaymentRow,
} from "@/lib/supabase/types";

export const dynamic = "force-dynamic";
const sources = new Set<PaymentPromiseSource>(["whatsapp", "call", "email", "portal", "in_person", "manual"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

async function caseAccess(caseId: string, write = false) {
  const auth = await getAuthenticatedBusiness(write ? "promise.manage" : "case.read");
  if ("error" in auth) return { error: auth.error ?? "Case service is unavailable.", status: 401 } as const;
  const { data, error } = await auth.client.from("cases").select("id,currency")
    .eq("id", caseId).eq("business_id", auth.businessId).maybeSingle();
  if (error) return { error: "Unable to load case.", status: 503 } as const;
  if (!data) return { error: "Case not found.", status: 404 } as const;
  return { ...auth, currency: (data as { currency?: string }).currency ?? "MYR", status: 200 } as const;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const access = await caseAccess(caseId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const [promisesResult, eventsResult, paymentsResult, allocationsResult] = await Promise.all([
    access.client.from("payment_promises").select("*").eq("case_id", caseId).order("created_at", { ascending: false }),
    access.client.from("payment_promise_events").select("*").eq("case_id", caseId).order("created_at", { ascending: false }),
    access.client.from("payments").select("*").eq("case_id", caseId).eq("review_status", "approved")
      .is("reversed_at", null).order("created_at", { ascending: false }),
    access.client.from("payment_promise_allocations").select("*").eq("business_id", access.businessId).is("reversed_at", null),
  ]);
  const error = promisesResult.error ?? eventsResult.error ?? paymentsResult.error ?? allocationsResult.error;
  if (error) return NextResponse.json({ error: "Unable to load payment promises." }, { status: 503 });
  return NextResponse.json({
    promises: promisesResult.data as PaymentPromiseRow[],
    events: eventsResult.data as PaymentPromiseEventRow[],
    payments: paymentsResult.data as PaymentRow[],
    allocations: allocationsResult.data as PaymentPromiseAllocationRow[],
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const access = await caseAccess(caseId, true);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.amount !== "string" || typeof body.promise_date !== "string"
    || !datePattern.test(body.promise_date) || typeof body.source !== "string"
    || !sources.has(body.source as PaymentPromiseSource)) {
    return NextResponse.json({ error: "Invalid payment promise details." }, { status: 400 });
  }
  let amountMinor: bigint;
  try {
    amountMinor = parseCurrencyToMinor(body.amount, access.currency);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid amount." }, { status: 400 });
  }
  const idempotencyKey = typeof body.idempotency_key === "string" && uuidPattern.test(body.idempotency_key)
    ? body.idempotency_key : crypto.randomUUID();
  const { data, error } = await access.client.rpc("payment_promise_create", {
    p_case_id: caseId, p_amount_minor: amountMinor.toString(), p_promise_date: body.promise_date,
    p_source: body.source as PaymentPromiseSource,
    p_source_activity_type: typeof body.source_activity_type === "string"
      ? body.source_activity_type.trim().slice(0, 100) || null : null,
    p_source_activity_id: typeof body.source_activity_id === "string"
      ? body.source_activity_id.trim().slice(0, 160) || null : null,
    p_note: typeof body.note === "string" ? body.note.trim().slice(0, 1000) || null : null,
    p_idempotency_key: idempotencyKey,
  });
  if (error || !data) return NextResponse.json(
    { error: error?.message ?? "Unable to create payment promise." }, { status: 409 },
  );
  return NextResponse.json({ promise: data as PaymentPromiseRow }, { status: 201 });
}
