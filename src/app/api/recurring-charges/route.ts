import { NextRequest, NextResponse } from "next/server";
import { appendSensitiveAudit, requireTenantPermission } from "@/lib/auth/tenant-access";
import { parseCurrencyToMinor } from "@/lib/financial/money";
import { firstRunDate, recurringChargeSchema, referencePrefixFromLabel } from "@/lib/receivables/recurring";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest) {
  const access = await requireTenantPermission("case.read");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status, headers });
  const accountId = request.nextUrl.searchParams.get("accountId");
  let query = access.service.from("recurring_charges").select("*").eq("business_id", access.businessId)
    .order("created_at", { ascending: false });
  if (accountId) query = query.eq("account_id", accountId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "We couldn't load repeating charges. Please try again." }, { status: 503, headers });
  return NextResponse.json({ charges: data ?? [] }, { headers });
}

export async function POST(request: NextRequest) {
  const access = await requireTenantPermission("case.manage");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status, headers });
  const parsed = recurringChargeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the repeating charge details." }, { status: 400, headers });
  }
  const input = parsed.data;

  const { data: account, error: accountError } = await access.service.from("customer_accounts")
    .select("id,customer_id,currency,account_mode,archived_at")
    .eq("id", input.account_id).eq("business_id", access.businessId).maybeSingle();
  if (accountError) return NextResponse.json({ error: "We couldn't check that account. Please try again." }, { status: 503, headers });
  const row = account as { id: string; customer_id: string; currency: string; account_mode?: string; archived_at: string | null } | null;
  if (!row || row.archived_at) return NextResponse.json({ error: "That account is no longer available." }, { status: 404, headers });
  if (row.account_mode && row.account_mode !== "ongoing") {
    return NextResponse.json({ error: "Repeating charges need an ongoing account. Edit the account and choose Ongoing first." }, { status: 409, headers });
  }

  let amountMinor: number;
  try {
    amountMinor = Number(parseCurrencyToMinor(input.amount, row.currency));
  } catch {
    return NextResponse.json({ error: "Enter an amount such as 1500 or 1500.00." }, { status: 400, headers });
  }
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    return NextResponse.json({ error: "The amount must be more than zero." }, { status: 400, headers });
  }

  const { data, error } = await access.service.from("recurring_charges").insert({
    business_id: access.businessId,
    customer_id: row.customer_id,
    account_id: row.id,
    label: input.label,
    reference_prefix: input.reference_prefix ?? referencePrefixFromLabel(input.label),
    obligation_type: input.obligation_type,
    amount_minor: amountMinor,
    currency: row.currency,
    day_of_month: input.day_of_month,
    due_days: input.due_days,
    start_date: input.start_date,
    end_date: input.end_date ?? null,
    next_run_date: firstRunDate(input.start_date, input.day_of_month),
    created_by: access.user.id,
  }).select("*").single();
  if (error || !data) return NextResponse.json({ error: "We couldn't save the repeating charge. Please try again." }, { status: 500, headers });

  await appendSensitiveAudit({
    access, request, action: "recurring_charge.created", entityType: "recurring_charge",
    entityId: (data as { id: string }).id, after: { label: input.label, amount_minor: amountMinor, day_of_month: input.day_of_month },
  });
  return NextResponse.json({ charge: data }, { status: 201, headers });
}
