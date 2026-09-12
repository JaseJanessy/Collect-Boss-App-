import { requireTenantPermission } from "@/lib/auth/tenant-access";
import { paymentApiError, paymentApiJson, paymentAuthError } from "@/lib/payment-operations/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const access = await requireTenantPermission("report.read");
  if ("error" in access) return paymentAuthError(access);
  const { data, error } = await access.service.from("accounting_payment_operation_outbox").select("id,provider,operation_type,source_table,source_id,status,attempts,next_attempt_at,external_record_id,last_error_code,last_error_message,created_at,updated_at")
    .eq("business_id", access.businessId).order("created_at", { ascending: false }).limit(200);
  if (error) return paymentApiError("ACCOUNTING_OUTBOX_UNAVAILABLE", "Accounting payment synchronization status could not be loaded.", 500);
  return paymentApiJson({ operations: data ?? [] });
}
