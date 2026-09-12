import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { appendSensitiveAudit, requireTenantPermission } from "@/lib/auth/tenant-access";

export const dynamic = "force-dynamic";

const replaySchema = z.object({ reason: z.string().trim().min(10).max(500) }).strict();

export async function POST(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const access = await requireTenantPermission("settings.sensitive.manage");
  if ("error" in access) return NextResponse.json({ error: { code: "FORBIDDEN", message: access.error } }, { status: access.status });
  const parsed = replaySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_FAILED", message: "Provide a replay reason of at least 10 characters." } }, { status: 400 });
  const jobId = (await params).jobId;
  const { data: job } = await access.service.from("integration_jobs").select("id,provider,job_type,status")
    .eq("id", jobId).eq("business_id", access.businessId).maybeSingle();
  if (!job) return NextResponse.json({ error: { code: "JOB_NOT_FOUND", message: "Replayable integration job not found." } }, { status: 404 });
  if (!["retry_scheduled", "dead_letter"].includes(job.status)) {
    return NextResponse.json({ error: { code: "JOB_NOT_REPLAYABLE", message: "Only failed or dead-letter jobs can be replayed." } }, { status: 409 });
  }
  const { data, error } = await access.service.rpc("integration_replay_job", {
    p_job_id: jobId, p_business_id: access.businessId, p_actor_id: access.user.id,
  });
  if (error || !data) return NextResponse.json({ error: { code: "REPLAY_FAILED", message: "The integration job could not be queued for replay." } }, { status: 503 });
  await appendSensitiveAudit({
    access, request, action: "integration.job_replayed", entityType: "integration_job", entityId: jobId,
    before: { provider: job.provider, job_type: job.job_type, status: job.status },
    after: { provider: job.provider, job_type: job.job_type, status: "pending" },
    metadata: { reason: parsed.data.reason },
  });
  return NextResponse.json({ job: data }, { headers: { "Cache-Control": "private, no-store" } });
}
