import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireReceivingAccountOwner } from "@/lib/receiving-accounts/server";
import { inspectQrImage, secureStoredFileResponse } from "@/lib/security/secure-file-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const BUCKET = "receiving-account-qr";
const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireReceivingAccountOwner();
  if ("error" in auth) return json({ error: auth.error }, auth.status);
  const { id } = await params;
  const { data: account } = await auth.service.from("receiving_accounts").select("qr_object_path").eq("id", id).eq("business_id", auth.business.id).maybeSingle();
  const path = (account as { qr_object_path: string | null } | null)?.qr_object_path;
  if (!path) return json({ error: "QR asset not found." }, 404);
  if (_request.nextUrl.searchParams.get("serve") !== "1") {
    return json({ url: `/api/receiving-accounts/${encodeURIComponent(id)}/qr?serve=1` });
  }
  if (!path.startsWith(`${auth.business.id}/${id}/`)) return json({ error: "QR asset scope is invalid." }, 410);
  const { data: blob, error } = await auth.service.storage.from(BUCKET).download(path);
  if (error || !blob) return json({ error: "Unable to open QR asset." }, 500);
  return secureStoredFileResponse({ blob, filename: "payment-qr", download: false, contentType: blob.type });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireReceivingAccountOwner(true);
  if ("error" in auth) return json({ error: auth.error }, auth.status);
  const { id } = await params;
  const form = await request.formData().catch(() => null);
  const file = form?.get("qr");
  const confirmation = form?.get("confirmation");
  if (confirmation !== "CHANGE PAYMENT DESTINATION") return json({ error: "Type the required confirmation phrase." }, 400);
  if (!(file instanceof File) || !["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size < 1 || file.size > 5 * 1024 * 1024) {
    return json({ error: "Upload a PNG, JPG, or WebP QR image up to 5 MB." }, 400);
  }
  const { data: owned } = await auth.service.from("receiving_accounts").select("id, qr_object_path").eq("id", id).eq("business_id", auth.business.id).maybeSingle();
  if (!owned) return json({ error: "Receiving account not found." }, 404);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const inspected = inspectQrImage(bytes, file.type);
  if (!inspected) return json({ error: "The QR image type does not match its contents." }, 400);
  const path = `${auth.business.id}/${id}/${randomUUID()}.${inspected.extension}`;
  const { error: uploadError } = await auth.service.storage.from(BUCKET).upload(path, bytes, { contentType: inspected.contentType, cacheControl: "private, no-store", upsert: false });
  if (uploadError) return json({ error: "Unable to store QR asset." }, 500);
  const { data, error } = await auth.service.rpc("receiving_account_set_qr_secure", { p_actor_id: auth.user.id, p_business_id: auth.business.id, p_account_id: id, p_qr_object_path: path });
  if (error || !data) {
    await auth.service.storage.from(BUCKET).remove([path]);
    return json({ error: error?.message || "Unable to attach QR asset." }, 409);
  }
  const previous = (owned as { qr_object_path: string | null }).qr_object_path;
  if (previous?.startsWith(`${auth.business.id}/${id}/`)) await auth.service.storage.from(BUCKET).remove([previous]);
  return json({ account: Array.isArray(data) ? data[0] : data }, 201);
}
