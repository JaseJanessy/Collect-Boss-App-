import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import type { PaymentPlanEventRow, PaymentPlanInstallmentRow, PaymentPlanRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function GET(_request: NextRequest, context: { params: Promise<{ caseId: string }> }) {
  const auth = await getAuthenticatedBusiness();
  if ("error" in auth) return response({ error: auth.error }, auth.error === "You must be signed in." ? 401 : 503);
  const { caseId } = await context.params;
  const { data: ownedCase } = await auth.client.from("cases").select("id")
    .eq("id", caseId).eq("business_id", auth.businessId).maybeSingle();
  if (!ownedCase) return response({ error: "Case not found." }, 404);

  const { data: planData, error: planError } = await auth.client.from("payment_plans").select("*")
    .eq("case_id", caseId).order("created_at", { ascending: false });
  if (planError) return response({ error: "Unable to load payment plans." }, 500);
  const plans = (planData ?? []) as PaymentPlanRow[];
  const planIds = plans.map((plan) => plan.id);
  if (planIds.length === 0) return response({ plans: [] });

  const [installmentResult, eventResult] = await Promise.all([
    auth.client.from("payment_plan_installments").select("*").in("payment_plan_id", planIds).order("sequence_no"),
    auth.client.from("payment_plan_events").select("*").in("payment_plan_id", planIds).order("created_at", { ascending: false }),
  ]);
  if (installmentResult.error || eventResult.error) return response({ error: "Unable to load payment-plan progress." }, 500);
  const installments = (installmentResult.data ?? []) as PaymentPlanInstallmentRow[];
  const events = (eventResult.data ?? []) as PaymentPlanEventRow[];
  return response({ plans: plans.map((plan) => ({
    ...plan,
    installments: installments.filter((item) => item.payment_plan_id === plan.id),
    events: events.filter((item) => item.payment_plan_id === plan.id),
  })) });
}

export async function POST(request: NextRequest, context: { params: Promise<{ caseId: string }> }) {
  const auth = await getAuthenticatedBusiness("promise.manage");
  if ("error" in auth) return response({ error: auth.error }, auth.error === "You must be signed in." ? 401 : 403);

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

  const { data: plan, error } = await auth.client.rpc("payment_plan_create_proposal", {
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
