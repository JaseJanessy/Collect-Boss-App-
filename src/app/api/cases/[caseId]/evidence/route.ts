import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import { createEvidenceObjectPath, EVIDENCE_BUCKET, MAX_EVIDENCE_FILES_PER_CASE, retentionDate, validateEvidenceUpload } from "@/lib/evidence/validation";
import { getServiceClient } from "@/lib/supabase/service-client";
import type { CaseRow, EvidenceFileRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";
const evidenceTypes = ["invoice", "whatsapp", "payment_proof", "contract", "delivery_order", "notes", "other"] as const;
const metadataSchema = z.object({ evidenceType: z.enum(evidenceTypes), description: z.string().trim().max(2000).optional(), documentDate: z.string().date().optional(), isInternal: z.enum(["true", "false"]).optional() });

function json(body: Record<string, unknown>, status = 200) { return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } }); }
async function scope(caseId: string, write = false) {
  const auth = await getAuthenticatedBusiness(write ? "case.manage" : "case.read");
  if ("error" in auth) return { error: auth.error ?? "Evidence service unavailable.", notFound: false } as const;
  const { data } = await auth.client.from("cases").select("id, business_id, archived_at").eq("id", caseId).eq("business_id", auth.businessId).maybeSingle();
  if (!data) return { error: "Case not found.", notFound: true } as const;
  return { ...auth, caseData: data as Pick<CaseRow, "id" | "business_id" | "archived_at"> };
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params; const found = await scope(caseId);
  if ("error" in found) return json({ error: found.error }, found.notFound ? 404 : 401);
  const { data, error } = await found.client.from("evidence_files").select("*").eq("case_id", caseId).is("archived_at", null).order("uploaded_at", { ascending: false });
  if (error) return json({ error: "Unable to load evidence." }, 500);
  return json({ files: (data ?? []) as EvidenceFileRow[] });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params; const found = await scope(caseId, true);
  if ("error" in found) return json({ error: found.error }, found.notFound ? 404 : 401);
  if (found.caseData.archived_at) return json({ error: "Archived cases cannot accept new evidence." }, 409);
  const form = await request.formData().catch(() => null); const file = form?.get("file");
  const metadata = metadataSchema.safeParse({ evidenceType: form?.get("evidenceType"), description: form?.get("description") || undefined, documentDate: form?.get("documentDate") || undefined, isInternal: form?.get("isInternal") || undefined });
  if (!(file instanceof File) || !metadata.success) return json({ error: "Invalid evidence upload." }, 400);
  const bytes = new Uint8Array(await file.arrayBuffer()); const validated = validateEvidenceUpload(file, bytes);
  if ("error" in validated) return json({ error: validated.error }, 422);
  const [{ count }, service] = await Promise.all([found.client.from("evidence_files").select("id", { count: "exact", head: true }).eq("case_id", caseId).is("archived_at", null), getServiceClient()]);
  if (!service) return json({ error: "Evidence upload service is unavailable." }, 503);
  if ((count ?? 0) >= MAX_EVIDENCE_FILES_PER_CASE) return json({ error: `A case may retain up to ${MAX_EVIDENCE_FILES_PER_CASE} active evidence files.` }, 409);
  const { data: duplicate } = await found.client.from("evidence_files").select("id").eq("case_id", caseId).eq("content_sha256", validated.sha256).is("archived_at", null).maybeSingle();
  if (duplicate) return json({ error: "This evidence file has already been uploaded to the case." }, 409);
  const path = createEvidenceObjectPath(found.businessId, caseId, validated.extension);
  const { error: storageError } = await service.storage.from(EVIDENCE_BUCKET).upload(path, bytes, { upsert: false, contentType: file.type, cacheControl: "private, no-store" });
  if (storageError) return json({ error: "Unable to store evidence." }, 502);
  const { data, error } = await found.client.from("evidence_files").insert({ case_id: caseId, file_name: file.name, file_type: validated.extension.toUpperCase(), file_url: path, object_path: path, file_size_bytes: file.size, evidence_type: metadata.data.evidenceType, description: metadata.data.description || null, document_date: metadata.data.documentDate || null, is_internal: metadata.data.isInternal !== "false", retention_until: retentionDate(), content_sha256: validated.sha256 }).select("*").single();
  if (error || !data) { await service.storage.from(EVIDENCE_BUCKET).remove([path]); return json({ error: "Evidence metadata could not be saved; the uploaded object was removed." }, 500); }
  await service.from("audit_logs").insert({ business_id: found.businessId, case_id: caseId, action: "evidence.uploaded", actor_type: "owner", metadata: { evidence_id: data.id, evidence_type: metadata.data.evidenceType, file_size: file.size } });
  return json({ file: data as EvidenceFileRow }, 201);
}
