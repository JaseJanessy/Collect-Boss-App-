import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import type { PaymentReviewStatus, PaymentRow } from "@/lib/supabase/types";
import { canTransitionPayment } from "@/lib/domain/workflows";

export const dynamic = "force-dynamic";

const PAYMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await getAuthenticatedBusiness("payment.approve");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

  const { id } = await params;
  const { decision } = await request.json().catch(() => ({})) as { decision?: unknown };
  if (!PAYMENT_ID.test(id) || (decision !== "approved" && decision !== "rejected" && decision !== "unmatched")) {
    return NextResponse.json({ error: "Invalid payment review." }, { status: 400 });
  }

  const { data: payment } = await access.client.from("payments").select("id,review_status").eq("id", id).maybeSingle();
  if (!payment) return NextResponse.json({ error: "Payment not found." }, { status: 404 });
  if (!canTransitionPayment(payment.review_status as PaymentReviewStatus, decision)) {
    return NextResponse.json({ error: `Payment status cannot move from ${payment.review_status} to ${decision}.` }, { status: 409 });
  }
  const { data, error } = await access.client.rpc("financial_review_payment", { p_payment_id: id, p_decision: decision });
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Unable to review payment." }, { status: 409 });
  return NextResponse.json({ payment: data as PaymentRow }, { headers: { "Cache-Control": "no-store" } });
}
