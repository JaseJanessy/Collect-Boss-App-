import { NextRequest, NextResponse } from "next/server";
import { getAppUrl } from "@/lib/app-url";
import { generatePublicToken, getOwnedCaseScope, hashPublicToken } from "@/lib/public-access/service";
import { getServerClient } from "@/lib/supabase/server-client";
import { getServiceClient } from "@/lib/supabase/service-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const ownerClient = await getServerClient();
  const { data: { user } } = ownerClient ? await ownerClient.auth.getUser() : { data: { user: null } };
  if (!user) return response({ error: "You must be signed in." }, 401);

  const { id } = await context.params;
  const body = await request.json().catch(() => ({})) as { expiresInHours?: unknown };
  const hours = typeof body.expiresInHours === "number" ? body.expiresInHours : 168;
  if (!Number.isInteger(hours) || hours < 1 || hours > 24 * 30) return response({ error: "Expiry must be between one hour and 30 days." }, 400);

  const service = await getServiceClient();
  if (!service) return response({ error: "Public link service is unavailable." }, 503);
  const { data: token } = await service.from("public_access_tokens").select("id, case_id, purpose").eq("id", id).maybeSingle();
  if (!token || !(await getOwnedCaseScope((token as { case_id: string }).case_id, user.id))) return response({ error: "Public link not found." }, 404);

  const rawToken = generatePublicToken();
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  const { data: replacement, error } = await service.rpc("public_rotate_access_token", {
    p_token_id: id,
    p_replacement_token_hash: hashPublicToken(rawToken),
    p_actor_id: user.id,
    p_expires_at: expiresAt,
  });
  if (error || !replacement) return response({ error: "Unable to rotate public link." }, 409);
  let baseUrl: string;
  try { baseUrl = getAppUrl(); } catch { return response({ error: "Public application URL is not configured correctly on this server." }, 503); }
  const purpose = (token as { purpose: "payment" | "acknowledgement" }).purpose;
  return response({ url: `${baseUrl}/${purpose === "payment" ? "pay" : "acknowledge"}/${rawToken}`, expiresAt, rotated: true }, 201);
}
