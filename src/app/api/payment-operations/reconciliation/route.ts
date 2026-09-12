import { NextRequest } from "next/server";
import { requireTenantPermission } from "@/lib/auth/tenant-access";
import { paymentApiError, paymentApiJson, paymentAuthError, paymentDatabaseError } from "@/lib/payment-operations/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const access = await requireTenantPermission("report.read");
  if ("error" in access) return paymentAuthError(access);
  const now = new Date();
  const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const from = new Date(request.nextUrl.searchParams.get("from") ?? defaultFrom.toISOString());
  const to = new Date(request.nextUrl.searchParams.get("to") ?? now.toISOString());
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) return paymentApiError("INVALID_RECONCILIATION_PERIOD", "Choose a valid reconciliation period.", 400);
  const { data, error } = await access.client.rpc("payment_operation_reconciliation", { p_business_id: access.businessId, p_from: from.toISOString(), p_to: to.toISOString() });
  if (error) return paymentDatabaseError(error.message);
  return paymentApiJson({ reconciliation: data });
}
