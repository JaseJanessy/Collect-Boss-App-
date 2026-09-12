import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import { caseReceivableScopeSchema } from "@/lib/validations/receivables";
import type { CustomerAccountRow, ObligationRow, RecoveryCaseObligationRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

function errorStatus(error: string) {
  if (error === "Recovery case not found.") return 404;
  if (error === "You must be signed in.") return 401;
  return 503;
}

async function ownedCase(caseId: string) {
  const auth = await getAuthenticatedBusiness();
  if ("error" in auth) return auth;
  const { data } = await auth.client.from("cases").select("*")
    .eq("id", caseId).eq("business_id", auth.businessId).maybeSingle();
  if (!data) return { error: "Recovery case not found." as const };
  return { ...auth, caseData: data };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ caseId: string }> },
) {
  const { caseId } = await params;
  const found = await ownedCase(caseId);
  if ("error" in found || !("caseData" in found)) {
    const error = ("error" in found && found.error) ? found.error : "Recovery case service is unavailable.";
    return NextResponse.json({ error }, { status: errorStatus(error) });
  }

  const linksResult = await found.client.from("recovery_case_obligations").select("*")
    .eq("business_id", found.businessId).eq("case_id", caseId);
  if (linksResult.error) return NextResponse.json({ error: "Unable to load case obligation links." }, { status: 500 });
  const links = (linksResult.data ?? []) as RecoveryCaseObligationRow[];
  const obligationsResult = links.length
    ? await found.client.from("obligations").select("*").eq("business_id", found.businessId).in("id", links.map((link) => link.obligation_id))
    : { data: [] as ObligationRow[], error: null };
  const accountResult = found.caseData.account_id
    ? await found.client.from("customer_accounts").select("*").eq("business_id", found.businessId).eq("id", found.caseData.account_id).maybeSingle()
    : { data: null as CustomerAccountRow | null, error: null };
  const reconcileResult = await found.client.rpc("receivables_reconcile_case", { p_case_id: caseId });
  if (obligationsResult.error || accountResult.error || reconcileResult.error) {
    return NextResponse.json({ error: "Unable to reconcile case receivables." }, { status: 500 });
  }
  return NextResponse.json({
    case: found.caseData,
    account: accountResult.data as CustomerAccountRow | null,
    obligations: (obligationsResult.data ?? []) as ObligationRow[],
    reconciliation: reconcileResult.data,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ caseId: string }> },
) {
  const { caseId } = await params;
  const found = await ownedCase(caseId);
  if ("error" in found || !("caseData" in found)) {
    const error = ("error" in found && found.error) ? found.error : "Recovery case service is unavailable.";
    return NextResponse.json({ error }, { status: errorStatus(error) });
  }
  const parsed = caseReceivableScopeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid case coverage selection." }, { status: 400 });
  const { data, error } = await found.client.rpc("receivables_set_case_scope", {
    p_case_id: caseId,
    p_scope: parsed.data.scope,
    p_account_id: parsed.data.account_id ?? null,
    p_obligation_ids: parsed.data.obligation_ids,
  });
  if (error) return NextResponse.json({ error: "Unable to update case coverage. Confirm customer, account, obligation and balance totals agree." }, { status: 422 });
  return NextResponse.json({ reconciliation: data });
}
