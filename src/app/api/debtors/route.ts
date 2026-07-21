import { NextRequest, NextResponse } from "next/server";
import { findDuplicateDebtors, getAuthenticatedBusiness } from "@/lib/debtors/server";
import { debtorWriteSchema } from "@/lib/validations/debtor";
import type { DebtorRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedBusiness();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.error === "You must be signed in." ? 401 : 503 });
  }

  const query = request.nextUrl.searchParams.get("query")?.trim().slice(0, 160) ?? "";
  const includeArchived = request.nextUrl.searchParams.get("includeArchived") === "true";
  let dbQuery = auth.client
    .from("debtors")
    .select("*")
    .eq("business_id", auth.businessId)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (!includeArchived) dbQuery = dbQuery.is("archived_at", null);
  if (query) {
    dbQuery = dbQuery.or([
      "individual_name.ilike.%" + query + "%",
      "business_name.ilike.%" + query + "%",
      "registration_no.ilike.%" + query + "%",
    ].join(","));
  }

  const { data, error } = await dbQuery;
  if (error) return NextResponse.json({ error: "Unable to load debtors." }, { status: 500 });
  return NextResponse.json({ debtors: (data ?? []) as DebtorRow[] }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedBusiness();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.error === "You must be signed in." ? 401 : 503 });
  }

  const body = await request.json().catch(() => null) as { allowDuplicate?: boolean } | null;
  const parsed = debtorWriteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Enter valid debtor details." }, { status: 400 });

  const duplicates = await findDuplicateDebtors(auth.client, auth.businessId, parsed.data);
  if (duplicates.length && !body?.allowDuplicate) {
    return NextResponse.json({ error: "Possible duplicate debtor.", duplicates }, { status: 409 });
  }

  const { data, error } = await auth.client
    .from("debtors")
    .insert({ ...parsed.data, business_id: auth.businessId })
    .select("*")
    .single();

  if (error || !data) return NextResponse.json({ error: "Unable to create debtor." }, { status: 500 });
  return NextResponse.json({ debtor: data as DebtorRow }, { status: 201 });
}
