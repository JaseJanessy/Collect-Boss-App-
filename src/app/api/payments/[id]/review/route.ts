import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/server-client";
import type { PaymentRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

const PAYMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const client = await getServerClient();
  const { data: { user } } = client ? await client.auth.getUser() : { data: { user: null } };
  if (!client || !user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });

  const { id } = await params;
  const { decision } = await request.json().catch(() => ({})) as { decision?: unknown };
  if (!PAYMENT_ID.test(id) || (decision !== "approved" && decision !== "rejected" && decision !== "unmatched")) {
    return NextResponse.json({ error: "Invalid payment review." }, { status: 400 });
  }

  const { data, error } = await client.rpc("financial_review_payment", { p_payment_id: id, p_decision: decision });
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Unable to review payment." }, { status: 409 });
  return NextResponse.json({ payment: data as PaymentRow }, { headers: { "Cache-Control": "no-store" } });
}
