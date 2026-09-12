import { NextResponse } from "next/server";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import { loadCaseTimeline } from "@/lib/timeline/server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  if (!caseId || caseId.length > 100) return NextResponse.json({ error: "Invalid case ID." }, { status: 400 });
  const auth = await getAuthenticatedBusiness();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.error === "You must be signed in." ? 401 : 503 });
  try {
    const events = await loadCaseTimeline(auth.client, caseId, auth.businessId, "staff");
    return NextResponse.json({ events }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load case timeline.";
    return NextResponse.json({ error: message }, { status: message === "Case not found." ? 404 : 503 });
  }
}
