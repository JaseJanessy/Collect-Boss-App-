import { NextRequest } from "next/server";
import { requireTenantPermission } from "@/lib/auth/tenant-access";
import { paymentApiJson, paymentAuthError, paymentDatabaseError, paymentValidationError } from "@/lib/payment-operations/api";
import { approvalDecisionInputSchema } from "@/lib/payment-operations/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  const access = await requireTenantPermission("payment.reallocation.approve");
  if ("error" in access) return paymentAuthError(access);
  const parsed = approvalDecisionInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return paymentValidationError(parsed.error);
  const { requestId } = await params;
  const { data, error } = await access.service.rpc("payment_operation_decide_approval", {
    p_business_id: access.businessId, p_request_id: requestId, p_actor_id: access.user.id,
    p_decision: parsed.data.decision, p_reason: parsed.data.reason,
  });
  if (error) return paymentDatabaseError(error.message);
  return paymentApiJson({ approvalRequest: data });
}
