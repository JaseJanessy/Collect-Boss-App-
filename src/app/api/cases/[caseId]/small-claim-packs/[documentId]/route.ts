import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import { generateSmallClaimPdf } from "@/lib/pdf/small-claim-generator";
import type { SmallClaimPackSnapshot } from "@/lib/small-claims/template";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ caseId: string; documentId: string }> }) {
  const { caseId, documentId } = await params;
  const auth = await getAuthenticatedBusiness();
  if ("error" in auth) return NextResponse.json({ error: auth.error ?? "Case-record pack service is unavailable." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const { data: caseData } = await auth.client.from("cases").select("id").eq("id", caseId).eq("business_id", auth.businessId).maybeSingle();
  if (!caseData) return NextResponse.json({ error: "Case not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const { data: document } = await auth.client.from("legal_documents").select("document_number, issued_at, snapshot, document_type, template_version").eq("id", documentId).eq("case_id", caseId).eq("document_type", "small_claim_pack").maybeSingle();
  if (!document || !document.issued_at || !document.snapshot) return NextResponse.json({ error: "Only an issued, immutable case-record pack can be downloaded." }, { status: 409, headers: { "Cache-Control": "no-store" } });
  const snapshot = document.snapshot as SmallClaimPackSnapshot;
  if (!snapshot.pdf || snapshot.templateVersion !== document.template_version || !snapshot.legalReviewRequired) return NextResponse.json({ error: "The case-record pack snapshot is invalid." }, { status: 409, headers: { "Cache-Control": "no-store" } });
  try {
    const pdf = await generateSmallClaimPdf(snapshot.pdf);
    return new NextResponse(await pdf.arrayBuffer(), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename=\"case-record-pack-${document.document_number ?? documentId}.pdf\"`, "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return NextResponse.json({ error: "Unable to render the issued case-record pack." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
