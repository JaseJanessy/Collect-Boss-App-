import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import type { DebtTruthEventDto, DebtTruthResponse, DebtTruthVersionDto } from "@/lib/debt-truth/api-types";

export const dynamic = "force-dynamic";

function failure(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

function validCaseId(value: string) {
  return value.length > 0 && value.length <= 100 && /^[A-Za-z0-9_-]+$/.test(value);
}

function stringifyMoney<T extends Record<string, unknown>>(row: T, fields: readonly string[]) {
  const copy: Record<string, unknown> = { ...row };
  for (const field of fields) if (copy[field] !== null && copy[field] !== undefined) copy[field] = String(copy[field]);
  return copy;
}

const balanceMoneyFields = [
  "original_principal_minor", "invoiced_amount_minor", "approved_adjustments_minor",
  "approved_fees_minor", "credit_notes_minor", "confirmed_payments_minor",
  "disputed_amount_minor", "unverified_amount_minor", "unverified_credit_minor",
  "confirmed_outstanding_minor", "total_displayed_exposure_minor", "overpayment_minor",
] as const;

export async function GET(request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  if (!validCaseId(caseId)) return failure("INVALID_CASE_ID", "Enter a valid case ID.", 400);
  const history = request.nextUrl.searchParams.get("history");
  if (history !== null && history !== "true" && history !== "false") {
    return failure("INVALID_QUERY", "The history parameter must be true or false.", 400);
  }
  const auth = await getAuthenticatedBusiness("case.read");
  if ("error" in auth) {
    const status = auth.error === "You must be signed in." ? 401 : 403;
    return failure(status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN", auth.error ?? "Access denied.", status);
  }
  const caseResult = await auth.client.from("cases").select("id,debt_truth_version")
    .eq("id", caseId).eq("business_id", auth.businessId).maybeSingle();
  if (caseResult.error) return failure("DEBT_TRUTH_UNAVAILABLE", "Unable to load the case debt ledger.", 503);
  if (!caseResult.data) return failure("CASE_NOT_FOUND", "Case not found.", 404);
  const [balanceResult, versionsResult, eventsResult] = await Promise.all([
    auth.client.from("debt_balance_versions_api").select("*").eq("case_id", caseId)
      .eq("business_id", auth.businessId).order("version", { ascending: false }).limit(1).maybeSingle(),
    history === "true" ? auth.client.from("debt_balance_versions_api").select("*").eq("case_id", caseId)
      .eq("business_id", auth.businessId).order("version", { ascending: false }).limit(20)
      : Promise.resolve({ data: [], error: null }),
    auth.client.from("debt_ledger_events_api").select("id,event_kind,amount_minor,currency,approval_status,source_table,source_id,source_version,evidence_citations,reverses_event_id,reason,created_at")
      .eq("case_id", caseId).eq("business_id", auth.businessId).order("created_at", { ascending: true }).limit(500),
  ]);
  if (balanceResult.error ?? versionsResult.error ?? eventsResult.error) {
    return failure("DEBT_TRUTH_UNAVAILABLE", "Unable to load the canonical debt ledger.", 503);
  }
  if (!balanceResult.data) return failure("DEBT_TRUTH_NOT_RECONCILED", "This case has not been reconciled into the canonical debt ledger.", 409);
  const balance = stringifyMoney(balanceResult.data, balanceMoneyFields) as unknown as DebtTruthVersionDto;
  const versions = (versionsResult.data ?? []).map((row: Record<string, unknown>) => stringifyMoney(row, balanceMoneyFields)) as unknown as DebtTruthVersionDto[];
  const events = (eventsResult.data ?? []).map((row: Record<string, unknown>) => stringifyMoney(row, ["amount_minor"])) as unknown as DebtTruthEventDto[];
  const response: DebtTruthResponse = { balance, versions, events };
  return NextResponse.json(response, { headers: { "Cache-Control": "private, no-store" } });
}
