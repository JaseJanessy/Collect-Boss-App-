import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import { debtorWriteSchema } from "@/lib/validations/debtor";
import type { DebtorRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ debtorId: string }> };

async function getOwnedDebtor(debtorId: string) {
  const auth = await getAuthenticatedBusiness();
  if ("error" in auth) return auth;
  const { data, error } = await auth.client
    .from("debtors")
    .select("*")
    .eq("id", debtorId)
    .eq("business_id", auth.businessId)
    .maybeSingle();
  if (error || !data) return { error: "Debtor not found." as const, status: 404 as const };
  return { ...auth, debtor: data as DebtorRow };
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { debtorId } = await context.params;
  const result = await getOwnedDebtor(debtorId);
  if (!("debtor" in result)) {
    return NextResponse.json({ error: result.error }, { status: "status" in result ? result.status : 401 });
  }

  const { count } = await result.client
    .from("cases")
    .select("id", { count: "exact", head: true })
    .eq("debtor_id", debtorId);
  return NextResponse.json({ debtor: result.debtor, linkedCaseCount: count ?? 0 }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { debtorId } = await context.params;
  const result = await getOwnedDebtor(debtorId);
  if (!("debtor" in result)) {
    return NextResponse.json({ error: result.error }, { status: "status" in result ? result.status : 401 });
  }

  const body = await request.json().catch(() => null) as { archived?: boolean } | null;
  if (body && typeof body.archived === "boolean") {
    const { data, error } = await result.client
      .from("debtors")
      .update({ archived_at: body.archived ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
      .eq("id", debtorId)
      .eq("business_id", result.businessId)
      .select("*")
      .single();
    if (error || !data) return NextResponse.json({ error: "Unable to update archive status." }, { status: 500 });
    return NextResponse.json({ debtor: data as DebtorRow });
  }

  const parsed = debtorWriteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Enter valid debtor details." }, { status: 400 });
  const { data, error } = await result.client
    .from("debtors")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", debtorId)
    .eq("business_id", result.businessId)
    .select("*")
    .single();
  if (error || !data) return NextResponse.json({ error: "Unable to update debtor." }, { status: 500 });
  return NextResponse.json({ debtor: data as DebtorRow });
}
