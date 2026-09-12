import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";
import type { BusinessExportDataset } from "./selection";

const PAGE_SIZE = 1_000;
const MAX_ROWS_PER_DATASET = 50_000;
const CASE_ID_BATCH_SIZE = 500;

type TenantServiceClient = SupabaseClient<Database>;
type ExportRow = Record<string, unknown>;

export class BusinessDataExportError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message);
  }
}

export interface BusinessDataExportManifest {
  export_id: string;
  schema_version: 1;
  generated_at: string;
  business: {
    id: string;
    name: string;
    legal_name: string | null;
  };
  requested_datasets: BusinessExportDataset[];
  row_counts: Record<BusinessExportDataset, number>;
  financial_ownership: "business_id";
}

export interface BusinessDataExportBundle {
  manifest: BusinessDataExportManifest;
  data: Partial<Record<BusinessExportDataset, ExportRow[]>>;
}

async function loadPaged(
  dataset: BusinessExportDataset,
  fetchPage: (from: number, to: number) => Promise<{
    data: ExportRow[] | null;
    error: { message: string } | null;
  }>,
): Promise<ExportRow[]> {
  const rows: ExportRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw new BusinessDataExportError(`Unable to export ${dataset}: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (rows.length > MAX_ROWS_PER_DATASET) {
      throw new BusinessDataExportError(
        `${dataset} export exceeds the ${MAX_ROWS_PER_DATASET.toLocaleString("en-MY")} row safety limit.`,
        413,
      );
    }
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function loadRowsForCaseIds(
  service: TenantServiceClient,
  dataset: "payments" | "statements",
  caseIds: string[],
  table: "payments" | "case_financial_events",
  columns: string,
): Promise<ExportRow[]> {
  const rows: ExportRow[] = [];
  for (let index = 0; index < caseIds.length; index += CASE_ID_BATCH_SIZE) {
    const ids = caseIds.slice(index, index + CASE_ID_BATCH_SIZE);
    const batch = await loadPaged(dataset, async (from, to) => {
      const result = await service.from(table).select(columns).in("case_id", ids)
        .order("created_at", { ascending: true }).range(from, to);
      return result as unknown as {
        data: ExportRow[] | null;
        error: { message: string } | null;
      };
    });
    rows.push(...batch);
    if (rows.length > MAX_ROWS_PER_DATASET) {
      throw new BusinessDataExportError(
        `${dataset} export exceeds the ${MAX_ROWS_PER_DATASET.toLocaleString("en-MY")} row safety limit.`,
        413,
      );
    }
  }
  return rows;
}

function statementHistoryMetadata(value: Json | null): Json | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const allowed = [
    "statement_type",
    "period",
    "period_start",
    "period_end",
  ] as const;
  return Object.fromEntries(allowed
    .filter((key) => key in value)
    .map((key) => [key, value[key]])) as Json;
}

export async function buildBusinessDataExport(input: {
  exportId: string;
  service: TenantServiceClient;
  business: { id: string; business_name: string; legal_name: string | null };
  datasets: BusinessExportDataset[];
}): Promise<BusinessDataExportBundle> {
  const { exportId, service, business, datasets } = input;
  const requested = new Set(datasets);
  const data: BusinessDataExportBundle["data"] = {};

  let scopedCases: ExportRow[] = [];
  if (requested.has("cases") || requested.has("payments") || requested.has("statements")) {
    scopedCases = await loadPaged("cases", async (from, to) => {
      const result = await service.from("cases")
        .select("id, business_id, business_entity_id, debtor_id, account_id, case_scope, debtor_name, debtor_company, invoice_no, due_date, currency, status, priority, assigned_to, next_follow_up_at, original_principal_minor, contractual_due_minor, approved_payment_minor, outstanding_minor, overpayment_minor, archived_at, created_at, updated_at")
        .eq("business_id", business.id).order("id", { ascending: true }).range(from, to);
      return result as unknown as { data: ExportRow[] | null; error: { message: string } | null };
    });
    if (requested.has("cases")) data.cases = scopedCases;
  }

  if (requested.has("customers")) {
    data.customers = await loadPaged("customers", async (from, to) => {
      const result = await service.from("debtors")
        .select("id, business_id, debtor_type, individual_name, business_name, contact_name, registration_no, phone, email, address, archived_at, merged_into_id, merged_at, created_at, updated_at")
        .eq("business_id", business.id).order("id", { ascending: true }).range(from, to);
      return result as unknown as { data: ExportRow[] | null; error: { message: string } | null };
    });
  }

  if (requested.has("accounts")) {
    data.accounts = await loadPaged("accounts", async (from, to) => {
      const result = await service.from("customer_accounts")
        .select("id, business_id, business_entity_id, customer_id, account_type, account_number, display_name, currency, account_mode, credit_limit_minor, credit_warning_threshold_percent, metadata, custom_fields, archived_at, created_at, updated_at")
        .eq("business_id", business.id).order("id", { ascending: true }).range(from, to);
      return result as unknown as { data: ExportRow[] | null; error: { message: string } | null };
    });
  }

  if (requested.has("invoices")) {
    const [obligations, pocketInvoices, pocketInvoiceItems, pocketInvoiceEvents] = await Promise.all([
      loadPaged("invoices", async (from, to) => {
        const result = await service.from("obligations")
          .select("id, business_id, business_entity_id, customer_id, account_id, obligation_type, reference, purchase_order_reference, issue_date, due_date, currency, original_amount_minor, adjustments_minor, paid_minor, contractual_due_minor, outstanding_minor, status, dispute_review_at, metadata, custom_fields, origin_product_type, archived_at, created_at, updated_at")
          .eq("business_id", business.id).order("id", { ascending: true }).range(from, to);
        return result as unknown as { data: ExportRow[] | null; error: { message: string } | null };
      }),
      loadPaged("invoices", async (from, to) => {
        const result = await service.from("pocket_simple_invoices").select("*")
          .eq("business_id", business.id).order("created_at", { ascending: true }).range(from, to);
        return result as unknown as { data: ExportRow[] | null; error: { message: string } | null };
      }),
      loadPaged("invoices", async (from, to) => {
        const result = await service.from("pocket_simple_invoice_items").select("*")
          .eq("business_id", business.id).order("created_at", { ascending: true }).range(from, to);
        return result as unknown as { data: ExportRow[] | null; error: { message: string } | null };
      }),
      loadPaged("invoices", async (from, to) => {
        const result = await service.from("pocket_simple_invoice_events").select("*")
          .eq("business_id", business.id).order("created_at", { ascending: true }).range(from, to);
        return result as unknown as { data: ExportRow[] | null; error: { message: string } | null };
      }),
    ]);
    data.invoices = [
      ...obligations.map((row) => ({ record_type: "obligation", ...row })),
      ...pocketInvoices.map((row) => ({ record_type: "pocket_simple_invoice", ...row })),
      ...pocketInvoiceItems.map((row) => ({ record_type: "pocket_simple_invoice_item", ...row })),
      ...pocketInvoiceEvents.map((row) => ({ record_type: "pocket_simple_invoice_event", ...row })),
    ];
    if (data.invoices.length > MAX_ROWS_PER_DATASET) throw new BusinessDataExportError(
      `invoices export exceeds the ${MAX_ROWS_PER_DATASET.toLocaleString("en-MY")} row safety limit.`, 413,
    );
  }

  const caseIds = scopedCases.map((item) => String(item.id));
  if (requested.has("payments")) {
    const [casePayments, pocketAllocations, pocketReceipts, pocketReceiptLinks] = await Promise.all([
      caseIds.length === 0 ? Promise.resolve([]) : loadRowsForCaseIds(
        service, "payments", caseIds, "payments",
        "id, case_id, amount, amount_minor, currency, payment_method, reference_no, review_status, reviewed_at, reviewed_by, notes, financial_event_id, reversed_at, reversed_by, reversal_reason, created_at",
      ),
      loadPaged("payments", async (from, to) => {
        const result = await service.from("payment_allocations").select("*")
          .eq("business_id", business.id).not("obligation_id", "is", null)
          .order("created_at", { ascending: true }).range(from, to);
        return result as unknown as { data: ExportRow[] | null; error: { message: string } | null };
      }),
      loadPaged("payments", async (from, to) => {
        const result = await service.from("payment_receipts").select("*")
          .eq("business_id", business.id).eq("source_system", "collectboss_pocket")
          .order("created_at", { ascending: true }).range(from, to);
        return result as unknown as { data: ExportRow[] | null; error: { message: string } | null };
      }),
      loadPaged("payments", async (from, to) => {
        const result = await service.from("pocket_receipt_payment_links").select("*")
          .eq("business_id", business.id).order("created_at", { ascending: true }).range(from, to);
        return result as unknown as { data: ExportRow[] | null; error: { message: string } | null };
      }),
    ]);
    data.payments = [
      ...casePayments.map((row) => ({ record_type: "case_payment", ...row })),
      ...pocketAllocations.map((row) => ({ record_type: "pocket_allocation_event", ...row })),
      ...pocketReceipts.map((row) => ({ record_type: "pocket_payment_receipt", ...row })),
      ...pocketReceiptLinks.map((row) => ({ record_type: "pocket_ocr_receipt_link", ...row })),
    ];
    if (data.payments.length > MAX_ROWS_PER_DATASET) throw new BusinessDataExportError(
      `payments export exceeds the ${MAX_ROWS_PER_DATASET.toLocaleString("en-MY")} row safety limit.`, 413,
    );
  }

  if (requested.has("activities")) {
    const [communications, pocketReminders] = await Promise.all([
      loadPaged("activities", async (from, to) => {
        const result = await service.from("communication_activities")
          .select("id, business_id, customer_id, case_id, channel, direction, status, outcome, started_at, completed_at, staff_user_id, external_reference, duration_seconds, related_promise_id, related_dispute_id, related_action_id, created_at, updated_at")
          .eq("business_id", business.id).order("started_at", { ascending: true }).range(from, to);
        return result as unknown as { data: ExportRow[] | null; error: { message: string } | null };
      }),
      loadPaged("activities", async (from, to) => {
        const result = await service.from("pocket_reminder_events").select("*")
          .eq("business_id", business.id).order("created_at", { ascending: true }).range(from, to);
        return result as unknown as { data: ExportRow[] | null; error: { message: string } | null };
      }),
    ]);
    data.activities = [
      ...communications.map((row) => ({ record_type: "communication_activity", ...row })),
      ...pocketReminders.map((row) => ({ record_type: "pocket_reminder_event", ...row })),
    ];
    if (data.activities.length > MAX_ROWS_PER_DATASET) throw new BusinessDataExportError(
      `activities export exceeds the ${MAX_ROWS_PER_DATASET.toLocaleString("en-MY")} row safety limit.`, 413,
    );
  }

  if (requested.has("statements")) {
    const [ledgerEvents, generatedHistory] = await Promise.all([
      caseIds.length === 0 ? Promise.resolve([]) : loadRowsForCaseIds(
        service,
        "statements",
        caseIds,
        "case_financial_events",
        "id, case_id, event_type, amount_minor, currency, source_table, source_id, actor_id, created_at",
      ),
      loadPaged("statements", async (from, to) => {
        const result = await service.from("audit_logs")
          .select("id, business_id, case_id, action, actor_type, actor_id, actor_role, metadata, created_at")
          .eq("business_id", business.id).eq("action", "statement.generated")
          .order("created_at", { ascending: true }).range(from, to);
        return result as unknown as { data: ExportRow[] | null; error: { message: string } | null };
      }),
    ]);
    data.statements = [
      ...ledgerEvents.map((item) => ({ record_type: "financial_event", ...item })),
      ...generatedHistory.map((item) => ({
        record_type: "generated_statement",
        ...item,
        metadata: statementHistoryMetadata((item.metadata ?? null) as Json | null),
      })),
    ];
    if (data.statements.length > MAX_ROWS_PER_DATASET) {
      throw new BusinessDataExportError(
        `statements export exceeds the ${MAX_ROWS_PER_DATASET.toLocaleString("en-MY")} row safety limit.`,
        413,
      );
    }
  }

  const rowCounts = Object.fromEntries(
    datasets.map((dataset) => [dataset, data[dataset]?.length ?? 0]),
  ) as Record<BusinessExportDataset, number>;

  return {
    manifest: {
      export_id: exportId,
      schema_version: 1,
      generated_at: new Date().toISOString(),
      business: {
        id: business.id,
        name: business.business_name,
        legal_name: business.legal_name,
      },
      requested_datasets: datasets,
      row_counts: rowCounts,
      financial_ownership: "business_id",
    },
    data,
  };
}
