import type { PaymentProofEventRow, PaymentProofStatus, PaymentProofSubmissionRow } from "@/lib/supabase/types";
import { requestJson } from "@/lib/data/http-service";

export type PaymentProofSubmission = PaymentProofSubmissionRow & { proofUrl: string | null; events: PaymentProofEventRow[] };
export type PaymentProofDecision = Extract<PaymentProofStatus, "under_review" | "confirmed" | "rejected" | "more_information_required">;

export async function getPaymentProofSubmissions(): Promise<PaymentProofSubmission[]> {
  const payload = await requestJson<{ submissions?: PaymentProofSubmission[] }>(
    "/api/payment-submissions",
    { cache: "no-store" },
    "Unable to load payment proofs.",
  );
  if (!payload.submissions) throw new Error("Unable to load payment proofs.");
  return payload.submissions;
}

export async function reviewPaymentProof(id: string, decision: PaymentProofDecision, reason?: string): Promise<PaymentProofStatus> {
  const payload = await requestJson<{ status?: PaymentProofStatus }>(`/api/payment-submissions/${encodeURIComponent(id)}/review`, {
    method: "POST",
    body: JSON.stringify({ decision, reason }),
  }, "Unable to review payment proof.");
  if (!payload.status) throw new Error("Unable to review payment proof.");
  return payload.status;
}
