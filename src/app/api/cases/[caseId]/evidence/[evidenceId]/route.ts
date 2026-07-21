import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import { EVIDENCE_BUCKET } from "@/lib/evidence/validation";
import { getServiceClient } from "@/lib/supabase/service-client";
import type { EvidenceFileRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";
function json(body: Record<string, unknown>, status = 200) { return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } }); }

async function scopedEvidence(caseId: string, evidenceId: string) {
  const auth = await getAuthenticatedBusiness();
  if ("error" in auth) return { error: auth.error ?? "Evidence service unavailable.", notFound: false } as const;
  const { data: caseData } = await auth.client.from("cases").select("id").eq("id", caseId).eq("business_id", auth.businessId).maybeSingle();
  if (!caseData) return { error: "Case not found.", notFound: true } as const;
  const { data: evidence } = await auth.client.from("evidence_files").select("*").eq("id", evidenceId).eq("case_id", caseId).is("archived_at", null).maybeSingle();
  if (!evidence) return { error: "Evidence file not found.", notFound: true } as const;
  return { ...auth, evidence: evidence as EvidenceFileRow };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ caseId: string; evidenceId: string }> }) {
  const { caseId, evidenceId } = await params; const found = await scopedEvidence(caseId, evidenceId);
  if ("error" in found) return json({ error: found.error }, found.notFound ? 404 : 401);
  const path = found.evidence.object_path || found.evidence.file_url;
  if (!path) return json({ error: "Evidence object is unavailable." }, 410);
  const service = await getServiceClient(); if (!service) return json({ error: "Evidence access service unavailable." }, 503);
  const mode = request.nextUrl.searchParams.get("mode") === "download" ? "download" : "preview";
  const { data, error } = await service.storage.from(EVIDENCE_BUCKET).createSignedUrl(path, 60, mode === "download" ? { download: found.evidence.file_name } : undefined);
  if (error || !data?.signedUrl) return json({ error: "Unable to create evidence access link." }, 502);
  return json({ url: data.signedUrl, expiresInSeconds: 60, mode });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ caseId: string; evidenceId: string }> }) {
  const { caseId, evidenceId } = await params; const found = await scopedEvidence(caseId, evidenceId);
  if ("error" in found) return json({ error: found.error }, found.notFound ? 404 : 401);
  const { data: { user } } = await found.client.auth.getUser();
  if (!user) return json({ error: "You must be signed in." }, 401);
  const { data, error } = await found.client.from("evidence_files").update({ archived_at: new Date().toISOString(), archived_by: user.id }).eq("id", evidenceId).is("archived_at", null).select("*").single();
  if (error || !data) return json({ error: "Unable to archive evidence." }, 409);
  const service = await getServiceClient();
  if (service) await service.from("audit_logs").insert({ business_id: found.businessId, case_id: caseId, action: "evidence.archived", actor_type: "owner", metadata: { evidence_id: evidenceId, retention_until: found.evidence.retention_until } });
  return json({ file: data as EvidenceFileRow });
}
