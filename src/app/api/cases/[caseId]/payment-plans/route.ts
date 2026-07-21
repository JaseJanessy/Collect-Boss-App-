import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/server-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function POST(request: NextRequest, context: { params: Promise<{ caseId: string }> }) {
  const client = await getServerClient();
  const { data: { user } } = client ? await client.auth.getUser() : { data: { user: null } };
  if (!client || !user) return response({ error: "You must be signed in." }, 401);

  const { caseId } = await context.params;
  const body = await request.json().catch(() => null) as {
    frequency?: unknown;
    firstDueDate?: unknown;
    installmentCount?: unknown;
    customDueDates?: unknown;
    notes?: unknown;
  } | null;
  const frequency = body?.frequency;
  const count = body?.installmentCount;
  const notes = typeof body?.notes === "string" ? body.notes.trim() : "";
  const customDueDates = Array.isArray(body?.customDueDates) ? body.customDueDates : [];

  if (frequency !== "weekly" && frequency !== "monthly" && frequency !== "custom") {
    return response({ error: "Choose a valid payment frequency." }, 400);
  }
  if (!isDate(body?.firstDueDate) || typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 24 || notes.length > 1000) {
    return response({ error: "Enter valid payment-plan terms." }, 400);
  }
  if (!customDueDates.every(isDate)) return response({ error: "Custom due dates must use YYYY-MM-DD." }, 400);

  const { data: plan, error } = await client.rpc("payment_plan_create_proposal", {
    p_case_id: caseId,
    p_frequency: frequency,
    p_first_due_date: body.firstDueDate,
    p_installment_count: count,
    p_custom_due_dates: customDueDates,
    p_notes: notes || null,
  });
  if (error || !plan) return response({ error: error?.message ?? "Unable to create payment-plan proposal." }, 409);
  return response({ plan }, 201);
}
