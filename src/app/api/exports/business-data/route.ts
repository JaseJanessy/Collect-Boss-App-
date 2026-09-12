import type { NextRequest } from "next/server";
import { appendSensitiveAudit, requireTenantPermission } from "@/lib/auth/tenant-access";
import { buildBusinessDataExport, BusinessDataExportError } from "@/lib/exports/business-data";
import { normalizeExportDatasets } from "@/lib/exports/selection";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let datasets;
  try {
    const body = await request.json().catch(() => ({})) as { datasets?: unknown };
    datasets = normalizeExportDatasets(body.datasets);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid export request." },
      { status: 400 },
    );
  }

  const access = await requireTenantPermission("export.run");
  if ("error" in access) {
    return Response.json({ error: access.error }, { status: access.status });
  }

  const exportId = crypto.randomUUID();
  try {
    const bundle = await buildBusinessDataExport({
      exportId,
      service: access.service,
      business: access.business,
      datasets,
    });
    await appendSensitiveAudit({
      access,
      request,
      action: "business_data.exported",
      entityType: "data_export",
      entityId: exportId,
      after: {
        requested_datasets: datasets,
        row_counts: bundle.manifest.row_counts,
      },
      metadata: {
        schema_version: bundle.manifest.schema_version,
        format: "json",
      },
    });

    const date = bundle.manifest.generated_at.slice(0, 10);
    return new Response(JSON.stringify(bundle), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="collectboss-business-data-${date}-${exportId.slice(0, 8)}.json"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const status = error instanceof BusinessDataExportError ? error.status : 500;
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to export business data." },
      { status },
    );
  }
}
