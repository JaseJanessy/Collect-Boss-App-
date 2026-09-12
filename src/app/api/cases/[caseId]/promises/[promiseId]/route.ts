import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import type { PaymentPromiseRow } from "@/lib/supabase/types";
import { canTransitionPromise } from "@/lib/domain/workflows";

export const dynamic = "force-dynamic";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ caseId: string; promiseId: string }> },
) {
  const { caseId, promiseId } = await params;
  if (!uuidPattern.test(promiseId)) return NextResponse.json({ error: "Invalid promise ID." }, { status: 400 });
  const auth = await getAuthenticatedBusiness("promise.manage");
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: 401 });
  const { data: promise } = await auth.client.from("payment_promises").select("id,status")
    .eq("id", promiseId).eq("case_id", caseId).eq("business_id", auth.businessId).maybeSingle();
  if (!promise) return NextResponse.json({ error: "Payment promise not found." }, { status: 404 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") {
    return NextResponse.json({ error: "Invalid promise update." }, { status: 400 });
  }
  let result: { data: PaymentPromiseRow | null; error: { message: string } | null };
  if (body.action === "cancel") {
    if (!canTransitionPromise(promise.status, "cancelled")) {
      return NextResponse.json({ error: `Promise status cannot move from ${promise.status} to cancelled.` }, { status: 409 });
    }
    if (typeof body.reason !== "string" || !body.reason.trim()) {
      return NextResponse.json({ error: "A cancellation reason is required." }, { status: 400 });
    }
    result = await auth.client.rpc("payment_promise_cancel", {
      p_promise_id: promiseId, p_reason: body.reason.trim().slice(0, 500),
    });
  } else if (body.action === "match_payment") {
    if (!canTransitionPromise(promise.status, "partially_fulfilled")
      && !canTransitionPromise(promise.status, "fulfilled")) {
      return NextResponse.json({ error: `A ${promise.status} promise cannot receive a payment.` }, { status: 409 });
    }
    if (typeof body.payment_id !== "string" || !uuidPattern.test(body.payment_id)) {
      return NextResponse.json({ error: "Select a valid payment." }, { status: 400 });
    }
    const override = body.override === true;
    if (override && (typeof body.reason !== "string" || !body.reason.trim())) {
      return NextResponse.json({ error: "An override reason is required." }, { status: 400 });
    }
    result = await auth.client.rpc("payment_promise_apply_payment", {
      p_promise_id: promiseId, p_payment_id: body.payment_id, p_override: override,
      p_override_reason: override && typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : null,
    });
  } else {
    return NextResponse.json({ error: "Unsupported promise update." }, { status: 400 });
  }
  if (result.error || !result.data) return NextResponse.json(
    { error: result.error?.message ?? "Unable to update payment promise." }, { status: 409 },
  );
  return NextResponse.json({ promise: result.data });
}
