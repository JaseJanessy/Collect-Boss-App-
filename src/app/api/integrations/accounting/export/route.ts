/**
 * GET /api/integrations/accounting/export?dataset=customers|invoices
 *
 * CSV files for accounting software without a supported live connection,
 * such as SQL Account ("Import from Excel/Text" with column mapping).
 * Cells are protected against spreadsheet formula injection.
 */
import { NextRequest } from "next/server";
import { requireTenantPermission } from "@/lib/auth/tenant-access";
import { sanitizeCsvCell } from "@/lib/reports/metrics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_ROWS = 20_000;

/** Stable short customer code used in both files so invoices map to customers. */
function customerCode(customerId: string) {
  return `CB-${customerId.replaceAll("-", "").slice(0, 10).toUpperCase()}`;
}

function csv(rows: Array<Array<string | number | null>>) {
  return `﻿${rows.map((row) => row.map(sanitizeCsvCell).join(",")).join("\r\n")}\r\n`;
}

const money = (minor: number | string) => (Number(minor) / 100).toFixed(2);

export async function GET(request: NextRequest) {
  const access = await requireTenantPermission("report.read");
  if ("error" in access) return Response.json({ error: access.error }, { status: access.status });
  const dataset = request.nextUrl.searchParams.get("dataset");
  if (dataset !== "customers" && dataset !== "invoices") return Response.json({ error: "Choose customers or invoices." }, { status: 400 });

  const { data: debtors, error: debtorError } = await access.service.from("debtors")
    .select("id,business_name,individual_name,contact_name,registration_no,phone,email,address")
    .eq("business_id", access.businessId).is("archived_at", null).limit(MAX_ROWS);
  if (debtorError) return Response.json({ error: "We couldn't prepare the export. Please try again." }, { status: 503 });
  type Debtor = { id: string; business_name: string | null; individual_name: string | null; contact_name: string | null; registration_no: string | null; phone: string | null; email: string | null; address: string | null };
  const customers = (debtors ?? []) as Debtor[];
  const nameOf = (item: Debtor) => item.business_name || item.individual_name || item.contact_name || "";

  let body: string;
  if (dataset === "customers") {
    body = csv([
      ["Customer Code", "Company Name", "Contact Name", "Registration No", "Phone", "Email", "Address"],
      ...customers.map((item) => [customerCode(item.id), nameOf(item), item.contact_name, item.registration_no, item.phone, item.email, item.address]),
    ]);
  } else {
    const byId = new Map(customers.map((item) => [item.id, item]));
    const { data: obligations, error } = await access.service.from("obligations")
      .select("customer_id,reference,issue_date,due_date,currency,contractual_due_minor,paid_minor,outstanding_minor,status,metadata")
      .eq("business_id", access.businessId).is("archived_at", null).not("status", "in", "(draft,void)")
      .order("due_date").limit(MAX_ROWS);
    if (error) return Response.json({ error: "We couldn't prepare the export. Please try again." }, { status: 503 });
    type Obligation = { customer_id: string; reference: string; issue_date: string | null; due_date: string; currency: string; contractual_due_minor: number; paid_minor: number; outstanding_minor: number; status: string; metadata: { label?: string } | null };
    body = csv([
      ["Doc No", "Doc Date", "Due Date", "Customer Code", "Customer Name", "Currency", "Amount", "Paid", "Outstanding", "Status", "Description"],
      ...((obligations ?? []) as Obligation[]).map((item) => {
        const customer = byId.get(item.customer_id);
        return [
          item.reference, item.issue_date ?? item.due_date, item.due_date, customerCode(item.customer_id), customer ? nameOf(customer) : "",
          item.currency, money(item.contractual_due_minor), money(item.paid_minor), money(item.outstanding_minor), item.status,
          item.metadata?.label ?? `Invoice ${item.reference}`,
        ];
      }),
    ]);
  }

  const date = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="collectboss-${dataset}-${date}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
