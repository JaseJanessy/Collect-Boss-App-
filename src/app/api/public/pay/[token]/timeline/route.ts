import { NextResponse } from "next/server";
import { enforcePublicRateLimit, publicRateLimitResponse } from "@/lib/api/public-rate-limit";
import { getPublicActionContext } from "@/lib/public-access/service";
import { getServiceClient } from "@/lib/supabase/service-client";
import { loadCaseTimeline } from "@/lib/timeline/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rateLimit = await enforcePublicRateLimit({ headers: request.headers, rawToken: token, action: "timeline", limit: 30 });
  if (!rateLimit.allowed) return publicRateLimitResponse(rateLimit);
  const access = await getPublicActionContext(token, "payment");
  if (access.state !== "valid") {
    return NextResponse.json({ error: "Timeline is unavailable." }, {
      status: access.state === "unavailable" ? 503 : 404,
      headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });
  }
  const service = await getServiceClient();
  if (!service) return NextResponse.json({ error: "Timeline is unavailable." }, { status: 503 });
  try {
    const events = await loadCaseTimeline(service, access.caseScope.id, access.caseScope.business_id, "customer");
    return NextResponse.json({ events }, {
      headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
    });
  } catch {
    return NextResponse.json({ error: "Timeline is unavailable." }, { status: 503 });
  }
}
