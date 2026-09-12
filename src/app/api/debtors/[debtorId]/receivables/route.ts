import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import {
  customerAccountWriteSchema,
  customerAccountUpdateSchema,
  obligationWriteSchema,
  receivableChaseSchema,
} from "@/lib/validations/receivables";
import type { TenantPermission } from "@/lib/auth/permissions";
import type {
  AccountReceivableTotalsRow, CustomerAccountRow, DebtorRow,
  ObligationRow, ReceivableTotalsRow,
} from "@/lib/supabase/types";
import { parseCurrencyToMinor } from "@/lib/financial/money";

export const dynamic = "force-dynamic";

function errorStatus(error: string) {
  if (error === "Customer not found.") return 404;
  if (error === "You must be signed in.") return 401;
  return 503;
}

function decimalToMinor(value: string, currency: string, allowNegative = false) {
  return Number(parseCurrencyToMinor(value, currency, { allowZero: true, allowNegative }));
}

async function ownedCustomer(debtorId: string, permission: TenantPermission = "case.read") {
  const auth = await getAuthenticatedBusiness(permission);
  if ("error" in auth) return auth;
  const { data } = await auth.client
    .from("debtors")
    .select("*")
    .eq("id", debtorId)
    .eq("business_id", auth.businessId)
    .is("archived_at", null)
    .maybeSingle();
  if (!data) return { error: "Customer not found." as const };
  return { ...auth, customer: data as DebtorRow };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ debtorId: string }> },
) {
  const { debtorId } = await params;
  const found = await ownedCustomer(debtorId);
  if ("error" in found || !("customer" in found)) {
    const error = ("error" in found && found.error) ? found.error : "Customer service is unavailable.";
    const status = "status" in found && typeof found.status === "number" ? found.status : errorStatus(error);
    return NextResponse.json({ error }, { status });
  }

  const [accountsResult, accountTotalsResult, obligationsResult, casesResult, totalsResult, policyResult] = await Promise.all([
    found.client.from("customer_accounts").select("*").eq("business_id", found.businessId).eq("customer_id", debtorId).is("archived_at", null).order("created_at"),
    found.client.from("account_receivable_totals").select("*").eq("business_id", found.businessId).eq("customer_id", debtorId),
    found.client.from("obligations").select("*").eq("business_id", found.businessId).eq("customer_id", debtorId).is("archived_at", null)
      .order("issue_date", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }),
    found.client.from("cases").select("*").eq("business_id", found.businessId).eq("debtor_id", debtorId).is("archived_at", null).order("created_at", { ascending: false }),
    found.client.from("customer_receivable_totals").select("*").eq("business_id", found.businessId).eq("customer_id", debtorId).order("currency"),
    found.client.from("businesses").select("credit_limit_enforcement_enabled").eq("id", found.businessId).maybeSingle(),
  ]);
  const firstError = accountsResult.error ?? accountTotalsResult.error ?? obligationsResult.error
    ?? casesResult.error ?? totalsResult.error ?? policyResult.error;
  if (firstError) return NextResponse.json({ error: "Unable to load customer receivables." }, { status: 500 });

  const totalsByCurrency = (totalsResult.data ?? []) as ReceivableTotalsRow[];
  const totals = totalsByCurrency.length === 1 ? totalsByCurrency[0] : {
    business_id: found.businessId,
    customer_id: debtorId,
    currency: "MYR",
    contractual_due_minor: 0,
    paid_minor: 0,
    outstanding_minor: 0,
  };
  return NextResponse.json({
    customer: found.customer,
    accounts: (accountsResult.data ?? []) as CustomerAccountRow[],
    accountTotals: (accountTotalsResult.data ?? []) as AccountReceivableTotalsRow[],
    obligations: (obligationsResult.data ?? []) as ObligationRow[],
    cases: casesResult.data ?? [],
    creditLimitEnforcementEnabled: Boolean(
      (policyResult.data as { credit_limit_enforcement_enabled?: boolean } | null)
        ?.credit_limit_enforcement_enabled,
    ),
    totals,
    totalsByCurrency,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ debtorId: string }> },
) {
  const { debtorId } = await params;
  const found = await ownedCustomer(debtorId, "case.manage");
  if ("error" in found || !("customer" in found)) {
    const error = ("error" in found && found.error) ? found.error : "Customer service is unavailable.";
    const status = "status" in found && typeof found.status === "number" ? found.status : errorStatus(error);
    return NextResponse.json({ error }, { status });
  }
  const body = await request.json().catch(() => null) as ({ kind?: string } & Record<string, unknown>) | null;

  if (body?.kind === "account") {
    const parsed = customerAccountWriteSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Enter valid account details." }, { status: 400 });
    const { credit_limit, ...fields } = parsed.data;
    const { data, error } = await found.client.from("customer_accounts").insert({
      ...fields,
      business_id: found.businessId,
      customer_id: debtorId,
      credit_limit_minor: credit_limit ? decimalToMinor(credit_limit, fields.currency) : null,
    }).select("*").single();
    if (error || !data) return NextResponse.json({ error: "Unable to create customer account." }, { status: 500 });
    return NextResponse.json({ account: data as CustomerAccountRow }, { status: 201 });
  }

  if (body?.kind === "obligation") {
    const parsed = obligationWriteSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Enter valid invoice or obligation details." }, { status: 400 });
    if (parsed.data.account_id) {
      const { data: account } = await found.client.from("customer_accounts").select("id,currency")
        .eq("id", parsed.data.account_id).eq("business_id", found.businessId).eq("customer_id", debtorId)
        .is("archived_at", null).maybeSingle();
      if (!account) return NextResponse.json({ error: "The selected account is unavailable." }, { status: 404 });
      if ((account as { currency: string }).currency !== parsed.data.currency) {
        return NextResponse.json({ error: "Invoice currency must match the selected account currency." }, { status: 409 });
      }
    }
    const { original_amount, adjustments, paid_amount, ...fields } = parsed.data;
    const { data, error } = await found.client.from("obligations").insert({
      ...fields,
      business_id: found.businessId,
      customer_id: debtorId,
      original_amount_minor: decimalToMinor(original_amount, fields.currency),
      adjustments_minor: decimalToMinor(adjustments, fields.currency, true),
      paid_minor: decimalToMinor(paid_amount, fields.currency),
      status: "open",
    }).select("*").single();
    if (error || !data) {
      const enforced = error?.message.includes("Credit limit enforcement blocked");
      return NextResponse.json({
        error: enforced
          ? "This invoice would exceed the account credit limit and the business enforcement policy is enabled."
          : "Unable to create invoice or obligation.",
      }, { status: enforced ? 409 : 500 });
    }
    return NextResponse.json({ obligation: data as ObligationRow }, { status: 201 });
  }

  if (body?.kind === "chase") {
    const parsed = receivableChaseSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Select a valid invoice or account balance to chase." }, { status: 400 });
    const { data, error } = await found.client.rpc("receivables_create_recovery_case", {
      p_customer_id: debtorId,
      p_target: parsed.data.target,
      p_account_id: parsed.data.account_id,
      p_obligation_id: parsed.data.obligation_id ?? null,
      p_payment_lock_mode: parsed.data.payment_lock_mode,
    });
    if (error || !data) {
      const message = error?.message ?? "";
      const conflict = message.includes("already assigned") || message.includes("No open invoice");
      return NextResponse.json({
        error: conflict
          ? message
          : "Unable to create the recovery case for this receivable selection.",
      }, { status: conflict ? 409 : 422 });
    }
    return NextResponse.json({ recoveryCase: data }, { status: 201 });
  }

  return NextResponse.json({ error: "Unsupported receivable record type." }, { status: 400 });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ debtorId: string }> },
) {
  const { debtorId } = await params;
  const found = await ownedCustomer(debtorId, "case.manage");
  if ("error" in found || !("customer" in found)) {
    const error = ("error" in found && found.error) ? found.error : "Customer service is unavailable.";
    const status = "status" in found && typeof found.status === "number" ? found.status : errorStatus(error);
    return NextResponse.json({ error }, { status });
  }

  const parsed = customerAccountUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter valid account details." }, { status: 400 });
  const { account_id, credit_limit, ...fields } = parsed.data;
  const { data, error } = await found.client
    .from("customer_accounts")
    .update({
      ...fields,
      credit_limit_minor: credit_limit ? decimalToMinor(credit_limit, fields.currency) : null,
    })
    .eq("id", account_id)
    .eq("business_id", found.businessId)
    .eq("customer_id", debtorId)
    .is("archived_at", null)
    .select("*")
    .single();
  if (error || !data) return NextResponse.json({ error: "Unable to update the customer account." }, { status: 500 });
  return NextResponse.json({ account: data as CustomerAccountRow });
}
