import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/server-client";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const ownerClient = await getServerClient();
  const { data: { user } } = ownerClient ? await ownerClient.auth.getUser() : { data: { user: null } };
  if (!ownerClient || !user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });

  const { decision } = await request.json().catch(() => ({})) as { decision?: unknown };
  if (decision !== "approved" && decision !== "rejected") {
    return NextResponse.json({ error: "Choose approved or rejected." }, { status: 400 });
  }

  const { id } = await context.params;
  const { data: reviewed, error } = await ownerClient.rpc("financial_review_public_payment_submission", {
    p_submission_id: id,
    p_decision: decision,
  });
  if (error || !reviewed) return NextResponse.json({ error: error?.message ?? "Unable to review submission." }, { status: 409 });
  return NextResponse.json({ reviewed: true, status: (reviewed as { status: string }).status }, { headers: { "Cache-Control": "no-store" } });
}
