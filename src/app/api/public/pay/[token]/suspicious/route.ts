import { NextResponse } from "next/server";
import { enforcePublicRateLimit, publicRateLimitResponse } from "@/lib/api/public-rate-limit";
import { reportSuspiciousPaymentRequest } from "@/lib/payment-access/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const categories = new Set([
  "do_not_recognise_business", "do_not_recognise_amount", "wrong_payment_details",
  "suspicious_payment_request", "suspected_illegal_lending", "other",
]);

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rateLimit = await enforcePublicRateLimit({ headers: request.headers, rawToken: token, action: "suspicious-report", limit: 8, windowSeconds: 300 });
  if (!rateLimit.allowed) return publicRateLimitResponse(rateLimit);
  const body = await request.json().catch(() => null) as { category?: unknown; details?: unknown } | null;
  const category = typeof body?.category === "string" ? body.category : "";
  const details = typeof body?.details === "string" ? body.details.trim() : "";
  if (!categories.has(category) || details.length > 1000) {
    return NextResponse.json({ error: "Choose a valid report reason." }, { status: 400 });
  }
  try {
    await reportSuspiciousPaymentRequest(token, category, details, request.headers);
    return NextResponse.json({ reported: true }, {
      status: 201,
      headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });
  } catch {
    return NextResponse.json({ error: "Unable to submit the report." }, { status: 503 });
  }
}
