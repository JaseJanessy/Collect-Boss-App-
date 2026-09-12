import { NextRequest, NextResponse } from "next/server";
import { appendSensitiveAudit, requireTenantPermission } from "@/lib/auth/tenant-access";
import { getAppUrl } from "@/lib/app-url";
import { generatePublicToken, hashPublicToken } from "@/lib/public-access/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await requireTenantPermission("public_link.manage");
  if ("error" in access) return response({ error: access.error }, access.status);

  const { id } = await context.params;
  const body = await request.json().catch(() => ({})) as { expiresInHours?: unknown };
  const hours = typeof body.expiresInHours === "number" ? body.expiresInHours : 168;
  if (!Number.isInteger(hours) || hours < 1 || hours > 24 * 30) return response({ error: "Expiry must be between one hour and 30 days." }, 400);

  const service = access.service;
  const { data: token } = await service.from("public_access_tokens").select("id, case_id, purpose")
    .eq("id", id).eq("business_id", access.businessId).maybeSingle();
  if (!token) return response({ error: "Public link not found." }, 404);

  const rawToken = generatePublicToken();
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  const { data: replacement, error } = await service.rpc("public_rotate_access_token", {
    p_token_id: id,
    p_replacement_token_hash: hashPublicToken(rawToken),
    p_actor_id: access.user.id,
    p_expires_at: expiresAt,
  });
  if (error || !replacement) return response({ error: "Unable to rotate public link." }, 409);
  await appendSensitiveAudit({ access, request, action: "public_link.rotated", entityType: "public_access_token",
    entityId: id, caseId: (token as { case_id: string }).case_id, metadata: { expires_at: expiresAt } });
  let baseUrl: string;
  try { baseUrl = getAppUrl(); } catch { return response({ error: "Public application URL is not configured correctly on this server." }, 503); }
  const purpose = (token as { purpose: "payment" | "acknowledgement" }).purpose;
  return response({ url: `${baseUrl}/${purpose === "payment" ? "pay" : "acknowledge"}/${rawToken}`, expiresAt, rotated: true }, 201);
}
