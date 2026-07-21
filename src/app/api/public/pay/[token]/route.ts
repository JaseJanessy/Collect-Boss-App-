import { NextRequest, NextResponse } from "next/server";
import { getPublicActionContext } from "@/lib/public-access/service";
import { getServiceClient } from "@/lib/supabase/service-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const access = await getPublicActionContext(token, "payment");
  if (access.state !== "valid") return response({ error: "Payment link is unavailable." }, 404);
  const body = await request.json().catch(() => null) as { name?: unknown; phone?: unknown; reason?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  if (!name || name.length > 160 || !phone || phone.length > 50) return response({ error: "Enter your name and phone number." }, 400);

  const service = await getServiceClient();
  if (!service) return response({ error: "Payment service is unavailable." }, 503);
  const { data: caseData } = await service.from("cases").select("payment_lock_mode, status, archived_at").eq("id", access.caseScope.id).maybeSingle();
  const currentCase = caseData as { payment_lock_mode: string; status: string; archived_at: string | null } | null;
  if (!currentCase || currentCase.status === "closed" || currentCase.status === "paid" || currentCase.archived_at || currentCase.payment_lock_mode !== "approval") return response({ error: "This link cannot request payment access." }, 409);
  const { data: row, error } = await service.from("payment_access_requests").insert({ case_id: access.caseScope.id, requester_name: name, requester_phone: phone, otp_verified: false, reason: typeof body?.reason === "string" ? body.reason.slice(0, 500) : null, status: "pending" }).select("id").single();
  if (error || !row) return response({ error: "Unable to request payment access." }, 409);
  const { error: tokenError } = await service.from("public_access_tokens").update({ payment_access_request_id: (row as { id: string }).id }).eq("id", access.token.id).is("payment_access_request_id", null);
  if (tokenError) return response({ error: "Unable to bind payment access." }, 409);
  return response({ requested: true }, 201);
}
