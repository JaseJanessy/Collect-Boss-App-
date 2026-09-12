import { NextResponse } from "next/server";
import { enforcePublicRateLimit, publicRateLimitResponse } from "@/lib/api/public-rate-limit";
import { paymentSessionCookieName, verifyPaymentOtp } from "@/lib/payment-access/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const response = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
});

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rateLimit = await enforcePublicRateLimit({ headers: request.headers, rawToken: token, action: "otp-verify", limit: 10, windowSeconds: 300 });
  if (!rateLimit.allowed) return publicRateLimitResponse(rateLimit);
  const body = await request.json().catch(() => null) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  try {
    const result = await verifyPaymentOtp(token, code, request.headers);
    if (result.status !== "verified" || !("rawSession" in result) || !result.rawSession) {
      const status = result.status === "expired" ? 410 : result.status === "locked" ? 423 : 401;
      return response({
        error: result.status === "expired"
          ? "This code has expired. Request a new code."
          : result.status === "locked"
            ? "Too many incorrect attempts. Request a new code later."
            : "The verification code is incorrect.",
        attemptsRemaining: "attempts_remaining" in result ? result.attempts_remaining : undefined,
      }, status);
    }
    const verified = response({ verified: true, expiresIn: result.expires_in ?? 900 });
    verified.cookies.set(paymentSessionCookieName(token), result.rawSession, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: result.expires_in ?? 900,
    });
    return verified;
  } catch {
    return response({ error: "Unable to verify the code. Please try again." }, 503);
  }
}
