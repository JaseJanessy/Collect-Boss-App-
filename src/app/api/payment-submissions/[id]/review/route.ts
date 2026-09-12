import { NextRequest, NextResponse } from "next/server";
import { appendSensitiveAudit } from "@/lib/auth/tenant-access";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import { secureStoredFileResponse } from "@/lib/security/secure-file-response";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await getAuthenticatedBusiness("payment.approve");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  if (request.nextUrl.searchParams.get("asset") !== "proof") {
    return NextResponse.json({ error: "Payment proof not found." }, { status: 404 });
  }
  const { id } = await context.params;
  const { data: submission } = await access.service.from("public_payment_submissions")
    .select("id,case_id,proof_object_path,proof_content_type")
    .eq("id", id).eq("business_id", access.businessId).maybeSingle();
  const proof = submission as { case_id: string; proof_object_path: string | null; proof_content_type: string | null } | null;
  if (!proof?.proof_object_path || !proof.proof_object_path.startsWith(`${proof.case_id}/`)) {
    return NextResponse.json({ error: "Payment proof not found." }, { status: 404 });
  }
  const { data: blob, error } = await access.service.storage.from("payment-proofs").download(proof.proof_object_path);
  if (error || !blob) return NextResponse.json({ error: "Unable to open payment proof." }, { status: 502 });
  await appendSensitiveAudit({ access, request, action: "payment_proof.accessed", entityType: "public_payment_submission",
    entityId: id, caseId: proof.case_id });
  return secureStoredFileResponse({ blob, filename: `payment-proof-${id}`, download: false,
    contentType: proof.proof_content_type });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const access = await getAuthenticatedBusiness("payment.approve");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

  const { decision, reason } = await request.json().catch(() => ({})) as { decision?: unknown; reason?: unknown };
  if (decision !== "under_review" && decision !== "confirmed" && decision !== "rejected" && decision !== "more_information_required") {
    return NextResponse.json({ error: "Choose a valid review state." }, { status: 400 });
  }
  const normalizedReason = typeof reason === "string" ? reason.trim() : "";
  if ((decision === "rejected" || decision === "more_information_required") && normalizedReason.length < 3) {
    return NextResponse.json({ error: "Enter a reason of at least 3 characters." }, { status: 400 });
  }
  if (normalizedReason.length > 1000) return NextResponse.json({ error: "Review notes must be 1000 characters or fewer." }, { status: 400 });

  const { id } = await context.params;
  const { data: reviewed, error } = await access.client.rpc("financial_review_public_payment_submission", {
    p_submission_id: id,
    p_decision: decision,
    p_reason: normalizedReason || null,
  });
  if (error || !reviewed) return NextResponse.json({ error: error?.message ?? "Unable to review submission." }, { status: 409 });
  return NextResponse.json({ reviewed: true, status: (reviewed as { status: string }).status }, { headers: { "Cache-Control": "no-store" } });
}
