import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { appendSensitiveAudit, requireTenantPermission } from "@/lib/auth/tenant-access";
import type { CaseRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("assign_owner"),
    case_ids: z.array(z.string().min(1).max(100)).min(1).max(250),
    owner_id: z.string().uuid().nullable(),
  }),
  z.object({
    action: z.literal("follow_up"),
    case_ids: z.array(z.string().min(1).max(100)).min(1).max(250),
    follow_up_at: z.string().datetime(),
  }),
  z.object({
    action: z.literal("export"),
    case_ids: z.array(z.string().min(1).max(100)).min(1).max(250),
  }),
]);

function csv(value: unknown) {
  const raw = value === null || value === undefined ? "" : String(value);
  const text = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${text.replaceAll('"', '""')}"`;
}

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid bulk operation." }, { status: 400 });
  const access = await requireTenantPermission(parsed.data.action === "export" ? "export.run" : "case.manage");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const caseIds = [...new Set(parsed.data.case_ids)];

  if (parsed.data.action !== "export") {
    const value = parsed.data.action === "assign_owner"
      ? parsed.data.owner_id ?? ""
      : parsed.data.follow_up_at;
    const { data, error } = await access.client.rpc("bulk_update_cases", {
      p_business_id: access.businessId,
      p_case_ids: caseIds,
      p_action: parsed.data.action,
      p_value: value,
    });
    if (error || !data) return NextResponse.json({
      error: error?.code === "PGRST202"
        ? "Bulk actions require the R16 database migration."
        : error?.message ?? "Bulk action failed without changing cases.",
    }, { status: 409 });
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  }

  const { data, error } = await access.service.from("cases").select("*")
    .eq("business_id", access.businessId).in("id", caseIds).order("created_at");
  if (error || (data ?? []).length !== caseIds.length) {
    return NextResponse.json({ error: "One or more selected cases are unavailable." }, { status: 409 });
  }
  const cases = data as CaseRow[];
  const headers = [
    "Case ID", "Customer", "Company", "Phone", "Email", "Invoice", "Due Date",
    "Status", "Priority", "Outstanding Minor", "Assigned To", "Next Follow Up",
  ];
  const lines = [headers.map(csv).join(","), ...cases.map((item) => [
    item.id, item.debtor_name, item.debtor_company, item.debtor_phone, item.debtor_email,
    item.invoice_no, item.due_date, item.status, item.priority ?? "medium",
    item.outstanding_minor, item.assigned_to, item.next_follow_up_at,
  ].map(csv).join(","))];
  await appendSensitiveAudit({
    access, request, action: "cases.bulk_exported", entityType: "case_batch",
    metadata: { case_ids: caseIds, row_count: cases.length },
  });
  return new NextResponse("\uFEFF" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="collectboss-cases-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
