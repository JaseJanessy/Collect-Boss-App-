import { NextResponse } from "next/server";
import { requireTenantPermission } from "@/lib/auth/tenant-access";

function csv(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export async function GET(_request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const access = await requireTenantPermission("case.read");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const { batchId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) return NextResponse.json({ error: "Invalid batch ID." }, { status: 400 });
  const { data: batch } = await access.service.from("import_batches").select("id,file_name")
    .eq("id", batchId).eq("business_id", access.businessId).maybeSingle();
  if (!batch) return NextResponse.json({ error: "Import batch not found." }, { status: 404 });
  const { data, error } = await access.service.from("import_errors")
    .select("row_number,error_code,message,raw_row").eq("batch_id", batchId)
    .eq("business_id", access.businessId).order("row_number");
  if (error) return NextResponse.json({ error: "Unable to load the import error report." }, { status: 503 });
  const rows = [
    ["Row", "Code", "Message", "Source data"].map(csv).join(","),
    ...(data ?? []).map((item) => [
      item.row_number, item.error_code, item.message, JSON.stringify(item.raw_row),
    ].map(csv).join(",")),
  ];
  return new NextResponse("\uFEFF" + rows.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="collectboss-import-errors-${batchId}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}

