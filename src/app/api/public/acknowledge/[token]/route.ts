import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getPublicActionContext } from "@/lib/public-access/service";
import { getServiceClient } from "@/lib/supabase/service-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

function tokenError(state: "invalid" | "expired" | "used" | "unavailable") {
  if (state === "invalid") return response({ error: "Acknowledgement link is invalid." }, 404);
  if (state === "unavailable") return response({ error: "Acknowledgement service is temporarily unavailable." }, 503);
  return response({ error: "Acknowledgement link is no longer active." }, 410);
}

function ipHash(request: NextRequest): string | null {
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return address ? createHash("sha256").update(address).digest("hex") : null;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const access = await getPublicActionContext(token, "acknowledgement");
  if (access.state !== "valid") return tokenError(access.state);
  if (access.caseScope.status === "closed" || access.caseScope.status === "paid" || access.caseScope.archived_at || Number(access.caseScope.outstanding_minor ?? 0) <= 0) return tokenError("invalid");
  if (!access.token.payment_plan_id) return tokenError("invalid");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return response({ error: "Invalid acknowledgement request." }, 400);
  }

  const input = body as { signerName?: unknown; signerPhone?: unknown; decision?: unknown; rejectionReason?: unknown; consentAccepted?: unknown };
  const signerName = typeof input.signerName === "string" ? input.signerName.trim() : "";
  const signerPhone = typeof input.signerPhone === "string" ? input.signerPhone.trim() : "";
  const decision = input.decision === "rejected" ? "rejected" : input.decision === "accepted" ? "accepted" : null;
  const rejectionReason = typeof input.rejectionReason === "string" ? input.rejectionReason.trim() : "";

  if (!decision) return response({ error: "Choose whether to accept or reject the payment plan." }, 400);
  if (signerName.length > 160) {
    return response({ error: "Enter your full name." }, 400);
  }
  if (signerPhone.length > 50 || rejectionReason.length > 500) {
    return response({ error: "Payment-plan response is too long." }, 400);
  }
  if (decision === "accepted" && (!signerName || input.consentAccepted !== true)) {
    return response({ error: "You must confirm the acknowledgement before submitting." }, 400);
  }

  const client = await getServiceClient();
  if (!client) return tokenError("unavailable");

  const userAgent = request.headers.get("user-agent") ?? "";
  const { error } = await client.rpc("payment_plan_record_response", {
    p_token_id: access.token.id,
    p_decision: decision,
    p_signer_name: signerName,
    p_signer_phone: signerPhone,
    p_rejection_reason: rejectionReason || null,
    p_ip_hash: ipHash(request),
    p_actor_context: { user_agent_hash: userAgent ? createHash("sha256").update(userAgent).digest("hex") : null },
  });
  if (error) return response({ error: "This acknowledgement link is no longer active." }, 409);
  return response({ acknowledged: decision === "accepted", rejected: decision === "rejected" }, 201);
}
