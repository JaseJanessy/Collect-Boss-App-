import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobilePermission } from '@/lib/auth/mobile-access';
import {
  createEvidenceObjectPath,
  EVIDENCE_BUCKET,
  MAX_EVIDENCE_FILES_PER_CASE,
  retentionDate,
  validateEvidenceUpload,
} from '@/lib/evidence/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const evidenceTypes = ['invoice', 'whatsapp', 'payment_proof', 'contract', 'delivery_order', 'notes', 'other'] as const;
const metadataSchema = z.object({
  evidenceType: z.enum(evidenceTypes),
  description: z.string().trim().max(2_000).optional(),
  isInternal: z.enum(['true', 'false']).optional(),
});
const headers = { 'Cache-Control': 'private, no-store' };

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ caseId: string }> },
) {
  const access = await requireMobilePermission(request, 'case.manage');
  if ('error' in access) return json({ error: access.error }, access.status);
  const { caseId } = await context.params;
  const { data: caseData, error: caseError } = await access.service.from('cases')
    .select('id,archived_at').eq('id', caseId).eq('business_id', access.businessId).maybeSingle();
  if (caseError) return json({ error: 'Unable to verify the case.' }, 503);
  if (!caseData) return json({ error: 'Case not found.' }, 404);
  if (caseData.archived_at) return json({ error: 'Archived cases cannot accept new evidence.' }, 409);

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  const metadata = metadataSchema.safeParse({
    evidenceType: form?.get('evidenceType'),
    description: form?.get('description') || undefined,
    isInternal: form?.get('isInternal') || undefined,
  });
  if (!(file instanceof File) || !metadata.success) return json({ error: 'Invalid evidence upload.' }, 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const validated = validateEvidenceUpload(file, bytes);
  if ('error' in validated) return json({ error: validated.error }, 422);

  const [{ count, error: countError }, duplicateResult] = await Promise.all([
    access.service.from('evidence_files').select('id', { count: 'exact', head: true })
      .eq('case_id', caseId).is('archived_at', null),
    access.service.from('evidence_files').select('id').eq('case_id', caseId)
      .eq('content_sha256', validated.sha256).is('archived_at', null).maybeSingle(),
  ]);
  if (countError || duplicateResult.error) return json({ error: 'Unable to validate the evidence upload.' }, 503);
  if ((count ?? 0) >= MAX_EVIDENCE_FILES_PER_CASE) {
    return json({ error: `A case may retain up to ${MAX_EVIDENCE_FILES_PER_CASE} active evidence files.` }, 409);
  }
  if (duplicateResult.data) return json({ error: 'This evidence file has already been uploaded to the case.' }, 409);

  const path = createEvidenceObjectPath(access.businessId, caseId, validated.extension);
  const { error: storageError } = await access.service.storage.from(EVIDENCE_BUCKET).upload(path, bytes, {
    upsert: false,
    contentType: file.type,
    cacheControl: 'private, no-store',
  });
  if (storageError) return json({ error: 'Unable to store evidence.' }, 502);

  const { data, error } = await access.service.from('evidence_files').insert({
    case_id: caseId,
    file_name: file.name,
    file_type: validated.extension.toUpperCase(),
    file_url: path,
    object_path: path,
    file_size_bytes: file.size,
    evidence_type: metadata.data.evidenceType,
    description: metadata.data.description || null,
    is_internal: metadata.data.isInternal !== 'false',
    retention_until: retentionDate(),
    content_sha256: validated.sha256,
  }).select('*').single();
  if (error || !data) {
    await access.service.storage.from(EVIDENCE_BUCKET).remove([path]);
    return json({ error: 'Evidence metadata could not be saved; the uploaded object was removed.' }, 500);
  }
  await access.service.from('audit_logs').insert({
    business_id: access.businessId,
    case_id: caseId,
    action: 'evidence.uploaded',
    actor_type: 'staff',
    actor_id: access.user.id,
    metadata: { evidence_id: data.id, evidence_type: metadata.data.evidenceType, file_size: file.size, source: 'mobile' },
  });
  return json({ file: data }, 201);
}
