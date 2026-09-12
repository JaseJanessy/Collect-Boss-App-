import { NextResponse } from "next/server";
import { enforcePublicRateLimit, publicRateLimitResponse } from "@/lib/api/public-rate-limit";
import { requestPaymentOtp } from "@/lib/payment-access/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const response = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
});

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rateLimit = await enforcePublicRateLimit({ headers: request.headers, rawToken: token, action: "otp-request", limit: 6, windowSeconds: 600 });
  if (!rateLimit.allowed) return publicRateLimitResponse(rateLimit);
  const body = await request.json().catch(() => null) as { channel?: unknown } | null;
  if (body?.channel !== "email" && body?.channel !== "sms") {
    return response({ error: "Choose email or mobile verification." }, 400);
  }
  try {
    const result = await requestPaymentOtp(token, body.channel, request.headers);
    if (result.status === "cooldown") {
      return response({ error: "Please wait before requesting another code.", retryAfter: result.retry_after ?? 60 }, 429);
    }
    if (result.status === "rate_limited") {
      return response({ error: "Too many code requests. Please try again later." }, 429);
    }
    if (result.status === "unavailable") return response({ error: "Payment access is unavailable." }, 409);
    // Invalid capabilities and unavailable destinations use the same accepted
    // response to avoid contact/address enumeration.
    if (result.status === "accepted") return response({ sent: true, expiresIn: 420, resendAfter: 60 }, 202);
    if (result.status !== "sent") {
      return response({ error: "Unable to send a verification code. Please contact the creditor." }, 503);
    }
    return response({
      sent: true,
      maskedDestination: result.maskedDestination,
      expiresIn: result.expiresIn,
      resendAfter: result.resendAfter,
    }, 202);
  } catch (error) {
    console.error("[payment-otp] delivery unavailable:", error instanceof Error ? error.message : "unknown");
    return response({ error: "Unable to send a verification code. Please contact the creditor." }, 503);
  }
}
