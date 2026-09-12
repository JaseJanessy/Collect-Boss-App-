import { NextRequest } from "next/server";
import { requireTenantPermission } from "@/lib/auth/tenant-access";
import { paymentApiError, paymentApiJson, paymentAuthError, paymentValidationError } from "@/lib/payment-operations/api";
import { approvalRequestInputSchema } from "@/lib/payment-operations/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const access = await requireTenantPermission("payment.approve");
  if ("error" in access) return paymentAuthError(access);
  const { data, error } = await access.service.from("payment_allocation_approval_requests").select("*").eq("business_id", access.businessId).order("created_at", { ascending: false }).limit(200);
  if (error) return paymentApiError("APPROVALS_UNAVAILABLE", "Reallocation approval requests could not be loaded.", 500);
  return paymentApiJson({ approvalRequests: data ?? [] });
}

export async function POST(request: NextRequest) {
  const access = await requireTenantPermission("payment.approve");
  if ("error" in access) return paymentAuthError(access);
  const parsed = approvalRequestInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return paymentValidationError(parsed.error);
  const { data: receipt } = await access.service.from("payment_receipts").select("id").eq("id", parsed.data.receiptId).eq("business_id", access.businessId).maybeSingle();
  if (!receipt) return paymentApiError("RECEIPT_NOT_FOUND", "Payment receipt not found.", 404);
  const { data, error } = await access.service.from("payment_allocation_approval_requests").insert({
    business_id: access.businessId, receipt_id: parsed.data.receiptId, operation_type: "reallocation",
    proposed_allocations: parsed.data.allocations, reason: parsed.data.reason, requested_by: access.user.id,
  }).select("*").single();
  if (error) return paymentApiError("APPROVAL_CREATE_FAILED", "The reallocation approval request could not be created.", 500);
  return paymentApiJson({ approvalRequest: data }, 201);
}
