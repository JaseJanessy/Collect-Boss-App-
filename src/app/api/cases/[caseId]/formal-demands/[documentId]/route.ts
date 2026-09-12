import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import { generateDemandPdf } from "@/lib/pdf/demand-generator";
import { toDemandPdfData, type FormalDemandSnapshot } from "@/lib/formal-demands/template";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ caseId: string; documentId: string }> }) {
  const { caseId, documentId } = await params;
  const auth = await getAuthenticatedBusiness();
  if ("error" in auth) return NextResponse.json({ error: auth.error ?? "Formal-demand service is unavailable." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const { data: caseData } = await auth.client.from("cases").select("id").eq("id", caseId).eq("business_id", auth.businessId).maybeSingle();
  if (!caseData) return NextResponse.json({ error: "Case not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const { data: document } = await auth.client.from("legal_documents").select("document_number, issued_at, snapshot, document_type").eq("id", documentId).eq("case_id", caseId).in("document_type", ["demand_standard", "demand_firm", "demand_final"]).maybeSingle();
  if (!document || !document.issued_at || !document.snapshot) return NextResponse.json({ error: "Only an issued, immutable payment notice can be downloaded." }, { status: 409, headers: { "Cache-Control": "no-store" } });
  const snapshot = document.snapshot as FormalDemandSnapshot;
  if (!snapshot.pdf || !snapshot.documentNumber || snapshot.documentNumber !== document.document_number) return NextResponse.json({ error: "The formal-demand snapshot is invalid." }, { status: 409, headers: { "Cache-Control": "no-store" } });
  try {
    const pdf = await generateDemandPdf(toDemandPdfData(snapshot));
    const filename = snapshot.templateVersion < 2 ? "formal-demand" : "payment-notice";
    return new NextResponse(await pdf.arrayBuffer(), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename=\"${filename}-${snapshot.documentNumber}.pdf\"`, "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return NextResponse.json({ error: "Unable to render the issued payment notice." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
