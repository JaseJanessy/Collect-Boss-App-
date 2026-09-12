import { NextRequest, NextResponse } from "next/server";
import { requireTenantPermission } from "@/lib/auth/tenant-access";
import {
  autoMapHeaders, parseImportFile, validateImport, type ImportMapping,
} from "@/lib/imports/operational-import";
import type { Json } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function parseMapping(value: FormDataEntryValue | null): ImportMapping | null {
  if (typeof value !== "string") return null;
  try {
    const mapping = JSON.parse(value) as unknown;
    return mapping && typeof mapping === "object" && !Array.isArray(mapping) ? mapping as ImportMapping : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const access = await requireTenantPermission("case.manage");
  if ("error" in access) return response({ error: access.error }, access.status);
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const action = form?.get("action");
  if (!(file instanceof File) || !["preview", "dry_run", "commit"].includes(String(action))) {
    return response({ error: "Upload a CSV or XLSX file and choose a valid import action." }, 400);
  }
  let source;
  try { source = await parseImportFile(file); } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Unable to read the import file." }, 400);
  }
  if (action === "preview") {
    return response({
      file_name: source.fileName,
      file_type: source.fileType,
      headers: source.headers,
      sample_rows: source.rows.slice(0, 10),
      total_rows: source.rows.length,
      suggested_mapping: autoMapHeaders(source.headers),
    });
  }
  const mapping = parseMapping(form?.get("mapping") ?? null);
  if (!mapping) return response({ error: "Column mapping is missing or invalid." }, 400);
  let validation;
  try { validation = await validateImport(access.service, access.businessId, source, mapping); } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Unable to validate import." }, 400);
  }
  const confirmDuplicates = form?.get("confirm_duplicates") === "true";
  const batchStatus = action === "commit" ? "committing" : validation.errors.length ? "dry_run" : "ready";
  const { data: batch, error: batchError } = await access.service.from("import_batches").insert({
    business_id: access.businessId,
    file_name: source.fileName,
    file_type: source.fileType,
    status: batchStatus,
    total_rows: source.rows.length,
    valid_rows: validation.normalizedRows.length,
    invalid_rows: validation.errors.length,
    duplicate_rows: validation.duplicates.length,
    mapping,
    created_by: access.user.id,
  }).select("*").single();
  if (batchError || !batch) {
    return response({
      error: batchError?.code === "42P01"
        ? "Import reporting requires the R16 database migration."
        : "Unable to create an import audit batch.",
    }, 503);
  }
  if (validation.errors.length) {
    await access.service.from("import_errors").insert(validation.errors.map((error) => ({
      batch_id: batch.id,
      business_id: access.businessId,
      row_number: error.row_number,
      error_code: error.error_code,
      message: error.message,
      raw_row: error.raw_row as Json,
    })));
  }
  const summary = {
    batch_id: batch.id,
    total_rows: source.rows.length,
    valid_rows: validation.normalizedRows.length,
    invalid_rows: validation.errors.length,
    duplicate_rows: validation.duplicates.length,
    errors: validation.errors,
    duplicates: validation.duplicates,
    can_commit: validation.errors.length === 0 && (validation.duplicates.length === 0 || confirmDuplicates),
  };
  if (action === "dry_run") return response(summary);
  if (validation.errors.length) {
    await access.service.from("import_batches").update({
      status: "failed", error_summary: "Validation failed; no records were imported.",
    }).eq("id", batch.id).eq("business_id", access.businessId);
    return response({ ...summary, error: "Validation failed. No records were imported." }, 422);
  }
  if (validation.duplicates.length && !confirmDuplicates) {
    await access.service.from("import_batches").update({
      status: "failed", error_summary: "Duplicate confirmation was required; no records were imported.",
    }).eq("id", batch.id).eq("business_id", access.businessId);
    return response({ ...summary, error: "Review and confirm the duplicate matches before importing." }, 409);
  }
  const { data, error } = await access.client.rpc("commit_operational_import", {
    p_business_id: access.businessId,
    p_batch_id: batch.id,
    p_rows: validation.normalizedRows,
  });
  if (error || !data) {
    await access.service.from("import_batches").update({
      status: "failed",
      error_summary: `Atomic import failed; no records were committed. ${error?.message ?? ""}`.trim().slice(0, 1000),
    }).eq("id", batch.id).eq("business_id", access.businessId);
    return response({
      ...summary,
      error: error?.code === "PGRST202"
        ? "Atomic import requires the R16 database migration."
        : "The atomic import failed. No records were committed.",
    }, 409);
  }
  return response({ ...summary, result: data }, 201);
}

