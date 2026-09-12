import { z } from "zod";
import type { NextRequest } from "next/server";
import { appendSensitiveAudit, requireTenantPermission } from "@/lib/auth/tenant-access";
import { paymentApiError, paymentApiJson, paymentAuthError } from "@/lib/payment-operations/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const replaySchema = z.object({ reason: z.string().trim().min(10).max(500) }).strict();

export async function POST(request: NextRequest, { params }: { params: Promise<{ outboxId: string }> }) {
  const access = await requireTenantPermission("payment.approve");
  if ("error" in access) return paymentAuthError(access);
  const { outboxId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(outboxId)) return paymentApiError("INVALID_OUTBOX_ID", "Choose a valid accounting operation.", 400);
  const parsed = replaySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return paymentApiError("INVALID_REPLAY_REASON", "Provide a replay reason of at least 10 characters.", 400);
  const now = new Date().toISOString();
  const { data, error } = await access.service.from("accounting_payment_operation_outbox").update({
    status: "pending", attempts: 0, next_attempt_at: now, locked_at: null, last_error_code: null, last_error_message: null, updated_at: now,
  }).eq("id", outboxId).eq("business_id", access.businessId).in("status", ["failed", "configuration_required", "dead_letter"]).select("id,status,next_attempt_at").maybeSingle();
  if (error) return paymentApiError("ACCOUNTING_RETRY_FAILED", "The accounting operation could not be queued for retry.", 500);
  if (!data) return paymentApiError("ACCOUNTING_OPERATION_NOT_RETRYABLE", "The accounting operation was not found or is not retryable.", 409);
  await appendSensitiveAudit({
    access, request, action: "accounting.writeback_replayed", entityType: "accounting_payment_operation_outbox",
    entityId: outboxId, after: { status: "pending" }, metadata: { reason: parsed.data.reason },
  });
  return paymentApiJson({ operation: data });
}
