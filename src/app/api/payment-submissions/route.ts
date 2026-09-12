import { NextResponse } from "next/server";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import type { PaymentProofEventRow, PaymentProofSubmissionRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await getAuthenticatedBusiness("payment.approve");
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.error === "You must be signed in." ? 401 : 503 });

  const { data, error } = await auth.client
    .from("public_payment_submissions")
    .select("*")
    .eq("business_id", auth.businessId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Unable to load payment proofs." }, { status: 500 });

  const { data: eventData, error: eventError } = await auth.client
    .from("payment_proof_events")
    .select("*")
    .eq("business_id", auth.businessId)
    .order("created_at", { ascending: true });
  if (eventError) return NextResponse.json({ error: "Unable to load payment proof history." }, { status: 500 });
  const events = (eventData ?? []) as PaymentProofEventRow[];

  const submissions = ((data ?? []) as PaymentProofSubmissionRow[]).map((submission) => {
    const proofUrl = submission.proof_object_path
      ? `/api/payment-submissions/${encodeURIComponent(submission.id)}/review?asset=proof`
      : null;
    return { ...submission, proofUrl, events: events.filter((event) => event.submission_id === submission.id) };
  });

  return NextResponse.json({ submissions }, { headers: { "Cache-Control": "no-store" } });
}
