import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { appendSensitiveAudit, requireTenantPermission } from "@/lib/auth/tenant-access";
import { MyInvoisError, validationUrl, type MyInvoisEnvironment } from "@/lib/einvoice/myinvois-client";
import { EinvoiceInputError, submitObligationEinvoice } from "@/lib/einvoice/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

type DocumentRow = {
  id: string; obligation_id: string | null; environment: MyInvoisEnvironment; status: string; uuid: string | null;
  long_id: string | null; errors: string[]; submitted_at: string; validated_at: string | null;
};

function view(row: DocumentRow) {
  return {
    id: row.id, obligationId: row.obligation_id, status: row.status, errors: row.errors ?? [],
    submittedAt: row.submitted_at, validatedAt: row.validated_at,
    validationUrl: row.status === "valid" && row.uuid && row.long_id ? validationUrl(row.environment, row.uuid, row.long_id) : null,
    // LHDN allows cancellation within 72 hours of validation.
    cancellable: row.status === "valid" && Boolean(row.validated_at) && Date.now() - Date.parse(row.validated_at!) < 72 * 3600_000,
  };
}

/** Latest e-Invoice per invoice for ?obligationIds=a,b,c */
export async function GET(request: NextRequest) {
  const access = await requireTenantPermission("case.read");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status, headers });
  const ids = (request.nextUrl.searchParams.get("obligationIds") ?? "").split(",").filter((value) => /^[0-9a-f-]{36}$/i.test(value)).slice(0, 100);
  if (ids.length === 0) return NextResponse.json({ documents: [] }, { headers });
  const { data, error } = await access.service.from("einvoice_documents")
    .select("id,obligation_id,environment,status,uuid,long_id,errors,submitted_at,validated_at")
    .eq("business_id", access.businessId).in("obligation_id", ids).order("submitted_at", { ascending: false });
  if (error) return NextResponse.json({ error: "We couldn't load e-Invoice statuses." }, { status: 503, headers });
  const latest = new Map<string, DocumentRow>();
  for (const row of (data ?? []) as DocumentRow[]) if (row.obligation_id && !latest.has(row.obligation_id)) latest.set(row.obligation_id, row);
  return NextResponse.json({ documents: [...latest.values()].map(view) }, { headers });
}

export async function POST(request: NextRequest) {
  const access = await requireTenantPermission("case.manage");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status, headers });
  const parsed = z.object({ obligationId: z.uuid() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose an invoice to send." }, { status: 400, headers });
  try {
    const saved = await submitObligationEinvoice(access.service, {
      businessId: access.businessId, obligationId: parsed.data.obligationId, userId: access.user.id,
    }) as DocumentRow;
    await appendSensitiveAudit({
      access, request, action: "einvoice.submitted", entityType: "einvoice_document", entityId: saved.id,
      after: { obligation_id: parsed.data.obligationId, status: saved.status },
    });
    return NextResponse.json({ document: view(saved) }, { status: 201, headers });
  } catch (error) {
    if (error instanceof EinvoiceInputError) return NextResponse.json({ error: error.message, problems: error.problems }, { status: 400, headers });
    if (error instanceof MyInvoisError) {
      if (error.code === "23505" || /duplicate/i.test(error.message)) {
        return NextResponse.json({ error: "This invoice already has an e-Invoice in progress or validated." }, { status: 409, headers });
      }
      return NextResponse.json({ error: error.status === 503 ? "LHDN MyInvois is not reachable right now. Please try again later." : error.message }, { status: error.status >= 500 ? 502 : 400, headers });
    }
    return NextResponse.json({ error: "We couldn't send the e-Invoice. Please try again." }, { status: 500, headers });
  }
}
