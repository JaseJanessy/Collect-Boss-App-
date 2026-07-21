import { NextRequest, NextResponse } from "next/server";
import { findDuplicateDebtors, getAuthenticatedBusiness } from "@/lib/debtors/server";
import { caseStatusSchema, createCaseSchema } from "@/lib/validations/case";
import { minorToMyRDecimal, parseMyrToMinor } from "@/lib/financial/money";
import type { CaseRow, DebtorRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

function createCaseId() {
  return "CB-" + new Date().getFullYear() + "-" + crypto.randomUUID().replaceAll("-", "").slice(0, 12);
}

function parsePageParam(value: string | null, fallback: number, maximum: number) {
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= maximum ? parsed : null;
}

export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedBusiness();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.error === "You must be signed in." ? 401 : 503 });
  }

  const page = parsePageParam(request.nextUrl.searchParams.get("page"), 1, 10_000);
  const perPage = parsePageParam(request.nextUrl.searchParams.get("perPage"), 50, 100);
  if (page === null || perPage === null) {
    return NextResponse.json({ error: "Invalid pagination parameters." }, { status: 400 });
  }

  const requestedStatus = request.nextUrl.searchParams.get("status");
  const status = requestedStatus ? caseStatusSchema.safeParse(requestedStatus) : null;
  if (requestedStatus && !status?.success) {
    return NextResponse.json({ error: "Invalid case status filter." }, { status: 400 });
  }

  const rawQuery = request.nextUrl.searchParams.get("query")?.trim().slice(0, 100) ?? "";
  const search = rawQuery.replace(/[,%().]/g, "");
  let query = auth.client
    .from("cases")
    .select("*", { count: "exact" })
    .eq("business_id", auth.businessId)
    .order("created_at", { ascending: false });

  if (status?.success) query = query.eq("status", status.data);
  if (search) {
    query = query.or([
      `id.ilike.%${search}%`,
      `debtor_name.ilike.%${search}%`,
      `debtor_company.ilike.%${search}%`,
    ].join(","));
  }

  const start = (page - 1) * perPage;
  const { data, error, count } = await query.range(start, start + perPage - 1);
  if (error) return NextResponse.json({ error: "Unable to load cases." }, { status: 500 });

  return NextResponse.json(
    { cases: (data ?? []) as CaseRow[], page, perPage, total: count ?? 0 },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedBusiness();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.error === "You must be signed in." ? 401 : 503 });
  }

  const parsed = createCaseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter complete valid case details." }, { status: 400 });
  const input = parsed.data;
  let principalAmount: string;
  try { principalAmount = minorToMyRDecimal(parseMyrToMinor(input.amount_owed)); } catch {
    return NextResponse.json({ error: "Enter a valid case amount." }, { status: 400 });
  }

  let debtor: DebtorRow | null = null;
  let createdDebtorId: string | null = null;
  if (input.existing_debtor_id) {
    const { data } = await auth.client
      .from("debtors")
      .select("*")
      .eq("id", input.existing_debtor_id)
      .eq("business_id", auth.businessId)
      .is("archived_at", null)
      .maybeSingle();
    debtor = (data as DebtorRow | null) ?? null;
    if (!debtor) return NextResponse.json({ error: "The selected debtor is unavailable." }, { status: 404 });
  } else {
    const debtorInput = {
      debtor_type: input.debtor_type,
      individual_name: input.debtor_type === "individual" ? input.debtor_name.trim() : null,
      business_name: input.debtor_type === "business" ? input.debtor_company?.trim() || null : null,
      contact_name: input.debtor_contact_name?.trim() || null,
      registration_no: input.debtor_reg_no?.trim() || null,
      phone: input.debtor_phone?.trim() || null,
      email: input.debtor_email?.trim() || null,
      address: input.debtor_location?.trim() || null,
    };
    const duplicates = await findDuplicateDebtors(auth.client, auth.businessId, debtorInput);
    if (duplicates.length && !input.duplicate_acknowledged) {
      return NextResponse.json({ error: "Possible duplicate debtor.", duplicates }, { status: 409 });
    }
    const { data, error } = await auth.client
      .from("debtors")
      .insert({ ...debtorInput, business_id: auth.businessId })
      .select("*")
      .single();
    if (error || !data) return NextResponse.json({ error: "Unable to create the debtor." }, { status: 500 });
    debtor = data as DebtorRow;
    createdDebtorId = debtor.id;
  }

  const debtorName = debtor.debtor_type === "business"
    ? debtor.business_name ?? ""
    : debtor.individual_name ?? "";
  const { data: caseRow, error: caseError } = await auth.client
    .from("cases")
    .insert({
      id: createCaseId(),
      business_id: auth.businessId,
      debtor_id: debtor.id,
      debtor_type: debtor.debtor_type,
      debtor_name: debtorName,
      debtor_phone: debtor.phone,
      debtor_email: debtor.email,
      debtor_company: debtor.debtor_type === "business" ? debtor.business_name : null,
      debtor_reg_no: debtor.registration_no,
      debtor_location: debtor.address,
      amount_owed: principalAmount,
      amount_paid: 0,
      due_date: input.due_date,
      invoice_no: input.invoice_no?.trim() || null,
      status: "action_needed",
      payment_lock_mode: input.payment_lock_mode,
      notes: input.notes?.trim() || null,
    })
    .select("*")
    .single();

  if (caseError || !caseRow) {
    if (createdDebtorId) {
      await auth.client.from("debtors").delete().eq("id", createdDebtorId).eq("business_id", auth.businessId);
    }
    return NextResponse.json({ error: "Unable to create case." }, { status: 500 });
  }

  return NextResponse.json({ case: caseRow }, { status: 201 });
}
