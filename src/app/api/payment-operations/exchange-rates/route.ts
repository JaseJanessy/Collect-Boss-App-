import { NextRequest } from "next/server";
import { requireTenantPermission } from "@/lib/auth/tenant-access";
import { paymentApiError, paymentApiJson, paymentAuthError, paymentValidationError } from "@/lib/payment-operations/api";
import { exchangeRateInputSchema } from "@/lib/payment-operations/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const access = await requireTenantPermission("payment.approve");
  if ("error" in access) return paymentAuthError(access);
  const { data, error } = await access.service.from("payment_exchange_rates").select("*").eq("business_id", access.businessId).order("effective_at", { ascending: false }).limit(200);
  if (error) return paymentApiError("EXCHANGE_RATES_UNAVAILABLE", "Exchange-rate records could not be loaded.", 500);
  return paymentApiJson({ exchangeRates: data ?? [] });
}

export async function POST(request: NextRequest) {
  const access = await requireTenantPermission("payment.approve");
  if ("error" in access) return paymentAuthError(access);
  const parsed = exchangeRateInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return paymentValidationError(parsed.error);
  const { data, error } = await access.service.from("payment_exchange_rates").insert({
    business_id: access.businessId, source_currency: parsed.data.sourceCurrency, target_currency: parsed.data.targetCurrency,
    numerator: parsed.data.numerator, denominator: parsed.data.denominator, effective_at: parsed.data.effectiveAt,
    provider: parsed.data.provider, provider_record_id: parsed.data.providerRecordId, evidence: parsed.data.evidence, created_by: access.user.id,
  }).select("*").single();
  if (error) return paymentApiError(error.code === "23505" ? "EXCHANGE_RATE_EXISTS" : "EXCHANGE_RATE_CREATE_FAILED", error.code === "23505" ? "This exchange-rate record already exists." : "The exchange-rate record could not be created.", error.code === "23505" ? 409 : 500);
  return paymentApiJson({ exchangeRate: data }, 201);
}
