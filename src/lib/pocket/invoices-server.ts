import "server-only";

import { createHash } from "node:crypto";

import type { AppSupabaseClient } from "@/lib/supabase/client";
import { generatePocketInvoicePdf, type PocketInvoicePdfData } from "@/lib/pdf/pocket-invoice-generator";
import {
  calculatePocketInvoice,
  pocketInvoiceDisplayStatus,
  type PocketInvoiceDraftInput,
  type PocketInvoiceStatus,
} from "./invoices";

export const POCKET_INVOICE_BUCKET = "pocket-invoices";

export function pocketInvoiceServerError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("ADD_ON_REQUIRED")) return { status: 409, code: "ADD_ON_REQUIRED", error: "Activate the Simple Invoice add-on to create invoices." };
  if (message.includes("LIMIT_REACHED")) return { status: 409, code: "LIMIT_REACHED", error: "This billing cycle's invoice limit has been reached." };
  if (message.includes("READ_ONLY_MODE") || message.includes("SUBSCRIPTION")) return { status: 403, code: "READ_ONLY_MODE", error: "Invoice history is available, but new invoices are paused for this plan." };
  if (message.includes("CUSTOMER_NOT_FOUND")) return { status: 400, code: "CUSTOMER_NOT_FOUND", error: "Choose an active customer." };
  if (message.includes("NOT_FOUND")) return { status: 404, code: "INVOICE_NOT_FOUND", error: "Invoice not found." };
  if (message.includes("STALE")) return { status: 409, code: "STALE_INVOICE", error: "The invoice changed. Reload it before saving again." };
  if (message.includes("IMMUTABLE") || message.includes("INVALID_STATE")) return { status: 409, code: "INVALID_INVOICE_STATE", error: "This invoice cannot be changed in its current state." };
  return { status: 503, code: "INVOICE_UNAVAILABLE", error: "The invoice action is temporarily unavailable." };
}

type PocketAccess = {
  service: AppSupabaseClient;
  businessId: string;
  user: { id: string };
  business: { business_name?: unknown; default_currency?: unknown; logo_object_path?: unknown };
};

type InvoiceRow = {
  id: string; business_id: string; customer_id: string; status: PocketInvoiceStatus; invoice_number: string | null;
  issue_date: string; due_date: string; currency: string; business_name: string; business_contact: string | null;
  logo_object_path: string | null; customer_name: string; customer_contact: string | null; subtotal_minor: number;
  discount_minor: number; tax_label: string | null; tax_minor: number; total_minor: number; note: string | null;
  payment_instructions: string | null; obligation_id: string | null; pdf_object_path: string | null; pdf_sha256: string | null;
  pdf_generated_at: string | null; version: number; issued_at: string | null; cancelled_at: string | null; created_at: string; updated_at: string;
};

type ItemRow = { invoice_id: string; position: number; description: string; quantity_milli: number; unit_price_minor: number; line_total_minor: number };
type DebtRow = { id: string; paid_minor: number; outstanding_minor: number };

export interface PocketInvoiceView {
  id: string; customerId: string; status: PocketInvoiceStatus; invoiceNumber: string | null;
  issueDate: string; dueDate: string; currency: string; businessName: string; businessContact: string | null;
  logoObjectPath: string | null; customerName: string; customerContact: string | null;
  items: Array<{ position: number; description: string; quantityMilli: number; unitPriceMinor: number; lineTotalMinor: number }>;
  subtotalMinor: number; discountMinor: number; taxLabel: string | null; taxMinor: number; totalMinor: number;
  note: string | null; paymentInstructions: string | null; debtId: string | null; paidMinor: number | null; remainingMinor: number | null;
  version: number; issuedAt: string | null; cancelledAt: string | null; createdAt: string; updatedAt: string;
}

function mapInvoice(row: InvoiceRow, items: ItemRow[], debt?: DebtRow): PocketInvoiceView {
  return {
    id: row.id, customerId: row.customer_id,
    status: pocketInvoiceDisplayStatus(row.status, debt?.paid_minor ?? null, debt?.outstanding_minor ?? null),
    invoiceNumber: row.invoice_number, issueDate: row.issue_date, dueDate: row.due_date, currency: row.currency,
    businessName: row.business_name, businessContact: row.business_contact, logoObjectPath: row.logo_object_path,
    customerName: row.customer_name, customerContact: row.customer_contact,
    items: items.filter((item) => item.invoice_id === row.id).sort((a, b) => a.position - b.position).map((item) => ({
      position: item.position, description: item.description, quantityMilli: item.quantity_milli,
      unitPriceMinor: item.unit_price_minor, lineTotalMinor: item.line_total_minor,
    })),
    subtotalMinor: row.subtotal_minor, discountMinor: row.discount_minor, taxLabel: row.tax_label, taxMinor: row.tax_minor,
    totalMinor: row.total_minor, note: row.note, paymentInstructions: row.payment_instructions,
    debtId: row.obligation_id, paidMinor: debt?.paid_minor ?? null, remainingMinor: debt?.outstanding_minor ?? null,
    version: row.version, issuedAt: row.issued_at, cancelledAt: row.cancelled_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export async function loadPocketInvoices(access: PocketAccess, invoiceId?: string) {
  let query = access.service.from("pocket_simple_invoices").select("*").eq("business_id", access.businessId).order("created_at", { ascending: false });
  if (invoiceId) query = query.eq("id", invoiceId);
  const invoicesResult = await query;
  if (invoicesResult.error) throw new Error("Pocket invoices are temporarily unavailable.");
  const rows = (invoicesResult.data ?? []) as InvoiceRow[];
  const ids = rows.map((row) => row.id);
  const debtIds = rows.flatMap((row) => row.obligation_id ? [row.obligation_id] : []);
  const [itemsResult, debtsResult] = await Promise.all([
    ids.length ? access.service.from("pocket_simple_invoice_items").select("invoice_id,position,description,quantity_milli,unit_price_minor,line_total_minor").eq("business_id", access.businessId).in("invoice_id", ids) : { data: [], error: null },
    debtIds.length ? access.service.from("obligations").select("id,paid_minor,outstanding_minor").eq("business_id", access.businessId).in("id", debtIds) : { data: [], error: null },
  ]);
  if (itemsResult.error || debtsResult.error) throw new Error("Pocket invoice details are temporarily unavailable.");
  const items = (itemsResult.data ?? []) as ItemRow[];
  const debts = new Map(((debtsResult.data ?? []) as DebtRow[]).map((debt) => [debt.id, debt]));
  return rows.map((row) => mapInvoice(row, items, row.obligation_id ? debts.get(row.obligation_id) : undefined));
}

export async function savePocketInvoiceDraft(access: PocketAccess, input: PocketInvoiceDraftInput, params: { invoiceId?: string; expectedVersion?: number; operationKey: string }) {
  const currency = String(access.business.default_currency ?? "MYR").toUpperCase();
  const [customerResult, businessResult, existingResult] = await Promise.all([
    access.service.from("debtors").select("individual_name,business_name,phone,email,address").eq("business_id", access.businessId).eq("id", input.customerId).is("archived_at", null).is("merged_into_id", null).maybeSingle(),
    access.service.from("businesses").select("business_name,phone,email,address,logo_object_path").eq("id", access.businessId).maybeSingle(),
    params.invoiceId ? access.service.from("pocket_simple_invoices").select("logo_object_path").eq("business_id", access.businessId).eq("id", params.invoiceId).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (customerResult.error || !customerResult.data) throw new Error("POCKET_INVOICE_CUSTOMER_NOT_FOUND");
  if (businessResult.error || !businessResult.data) throw new Error("POCKET_INVOICE_NOT_AUTHORISED");
  const trustedInput: PocketInvoiceDraftInput = {
    ...input,
    businessName: String(businessResult.data.business_name),
    businessContact: input.businessContact || [businessResult.data.phone, businessResult.data.email, businessResult.data.address].filter(Boolean).join(" | ") || null,
    customerName: String(customerResult.data.individual_name ?? customerResult.data.business_name ?? "Customer"),
    customerContact: input.customerContact || [customerResult.data.phone, customerResult.data.email, customerResult.data.address].filter(Boolean).join(" | ") || null,
  };
  const totals = calculatePocketInvoice(trustedInput, currency);
  const { data, error } = await access.service.rpc("pocket_save_simple_invoice_draft", {
    p_business_id: access.businessId,
    p_actor_id: access.user.id,
    p_invoice_id: params.invoiceId ?? null,
    p_expected_version: params.expectedVersion ?? null,
    p_payload: {
      customerId: trustedInput.customerId, issueDate: trustedInput.issueDate, dueDate: trustedInput.dueDate, currency,
      businessName: trustedInput.businessName, businessContact: trustedInput.businessContact ?? "",
      logoObjectPath: existingResult.data?.logo_object_path ?? businessResult.data.logo_object_path ?? "",
      customerName: trustedInput.customerName, customerContact: trustedInput.customerContact ?? "",
      subtotalMinor: totals.subtotalMinor, discountMinor: totals.discountMinor, taxLabel: trustedInput.taxLabel ?? "",
      taxMinor: totals.taxMinor, totalMinor: totals.totalMinor, note: trustedInput.note ?? "", paymentInstructions: trustedInput.paymentInstructions ?? "",
    },
    p_items: totals.items,
    p_operation_key: params.operationKey,
  });
  if (error || !data) throw new Error(error?.message ?? "The invoice draft could not be saved.");
  return data as { invoiceId: string; version: number; status: "draft" };
}

export async function issuePocketInvoice(access: PocketAccess, invoiceId: string, expectedVersion: number, operationKey: string) {
  const { data, error } = await access.service.rpc("pocket_issue_simple_invoice", {
    p_business_id: access.businessId, p_actor_id: access.user.id, p_invoice_id: invoiceId,
    p_expected_version: expectedVersion, p_operation_key: operationKey,
  });
  if (error || !data) throw new Error(error?.message ?? "The invoice could not be issued.");
  return data as { invoiceId: string; invoiceNumber: string; status: "issued"; idempotentReplay: boolean };
}

export async function convertPocketInvoiceToDebt(access: PocketAccess, invoiceId: string, operationKey: string) {
  const { data, error } = await access.service.rpc("pocket_convert_invoice_to_debt", {
    p_business_id: access.businessId, p_actor_id: access.user.id, p_invoice_id: invoiceId, p_operation_key: operationKey,
  });
  if (error || !data) throw new Error(error?.message ?? "The invoice could not be linked to a Pocket debt.");
  return data as { invoiceId: string; debtId: string; idempotentReplay: boolean };
}

export async function cancelPocketInvoice(access: PocketAccess, invoiceId: string) {
  const { data: row, error: lookupError } = await access.service.from("pocket_simple_invoices").select("id,status,obligation_id").eq("business_id", access.businessId).eq("id", invoiceId).maybeSingle();
  if (lookupError || !row) throw new Error("POCKET_INVOICE_NOT_FOUND");
  if (row.status === "draft" || row.status === "cancelled" || row.obligation_id) throw new Error("POCKET_INVOICE_INVALID_STATE");
  const now = new Date().toISOString();
  const { error } = await access.service.from("pocket_simple_invoices").update({ status: "cancelled", cancelled_at: now, updated_by: access.user.id }).eq("business_id", access.businessId).eq("id", invoiceId).eq("status", "issued");
  if (error) throw new Error(error.message);
  await access.service.from("pocket_simple_invoice_events").insert({ business_id: access.businessId, invoice_id: invoiceId, event_type: "cancelled", actor_id: access.user.id, metadata: {} });
  return { ok: true };
}

function pdfData(invoice: PocketInvoiceView): PocketInvoicePdfData {
  return {
    invoiceNumber: invoice.invoiceNumber, status: invoice.status, businessName: invoice.businessName,
    businessContact: invoice.businessContact, customerName: invoice.customerName, customerContact: invoice.customerContact,
    issueDate: invoice.issueDate, dueDate: invoice.dueDate, currency: invoice.currency, items: invoice.items,
    subtotalMinor: invoice.subtotalMinor, discountMinor: invoice.discountMinor, taxLabel: invoice.taxLabel,
    taxMinor: invoice.taxMinor, totalMinor: invoice.totalMinor, note: invoice.note, paymentInstructions: invoice.paymentInstructions,
  };
}

export async function createPocketInvoicePdf(access: PocketAccess, invoice: PocketInvoiceView) {
  let logoDataUrl: string | null = null;
  if (invoice.logoObjectPath?.startsWith(`${access.businessId}/${invoice.id}/logo-`)) {
    const logo = await access.service.storage.from(POCKET_INVOICE_BUCKET).download(invoice.logoObjectPath);
    if (!logo.error && logo.data) {
      const bytes = new Uint8Array(await logo.data.arrayBuffer());
      const mime = bytes[0] === 0x89 && bytes[1] === 0x50 ? "image/png" : "image/jpeg";
      logoDataUrl = `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
    }
  }
  const bytes = generatePocketInvoicePdf({ ...pdfData(invoice), logoDataUrl });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (invoice.status === "draft") return { bytes, sha256, objectPath: null };
  const objectPath = `${access.businessId}/${invoice.id}/v${invoice.version}-${sha256.slice(0, 16)}.pdf`;
  const upload = await access.service.storage.from(POCKET_INVOICE_BUCKET).upload(objectPath, bytes, {
    upsert: false, contentType: "application/pdf", cacheControl: "private, no-store",
  });
  if (upload.error && !upload.error.message.toLowerCase().includes("already exists")) throw new Error("The private invoice PDF could not be stored.");
  const { error } = await access.service.from("pocket_simple_invoices").update({
    pdf_object_path: objectPath, pdf_sha256: sha256, pdf_generated_at: new Date().toISOString(), updated_by: access.user.id,
  }).eq("business_id", access.businessId).eq("id", invoice.id);
  if (error) {
    if (!upload.error) await access.service.storage.from(POCKET_INVOICE_BUCKET).remove([objectPath]);
    throw new Error("The invoice PDF record could not be completed.");
  }
  await access.service.from("pocket_simple_invoice_events").insert({ business_id: access.businessId, invoice_id: invoice.id, event_type: "pdf_generated", actor_id: access.user.id, metadata: { sha256, object_path: objectPath } });
  return { bytes, sha256, objectPath };
}

export async function uploadPocketInvoiceLogo(access: PocketAccess, invoiceId: string, file: File) {
  if (file.size <= 0 || file.size > 2 * 1024 * 1024) throw new Error("POCKET_INVOICE_LOGO_INVALID");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const png = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const jpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  if (!png && !jpeg) throw new Error("POCKET_INVOICE_LOGO_INVALID");
  const invoice = (await loadPocketInvoices(access, invoiceId))[0];
  if (!invoice) throw new Error("POCKET_INVOICE_NOT_FOUND");
  if (invoice.status !== "draft") throw new Error("POCKET_INVOICE_IMMUTABLE");
  const sha = createHash("sha256").update(bytes).digest("hex");
  const path = `${access.businessId}/${invoiceId}/logo-${sha.slice(0, 16)}.${png ? "png" : "jpg"}`;
  const upload = await access.service.storage.from(POCKET_INVOICE_BUCKET).upload(path, bytes, { upsert: false, contentType: png ? "image/png" : "image/jpeg", cacheControl: "private, no-store" });
  if (upload.error && !upload.error.message.toLowerCase().includes("already exists")) throw new Error("POCKET_INVOICE_LOGO_INVALID");
  const update = await access.service.from("pocket_simple_invoices").update({ logo_object_path: path, updated_by: access.user.id }).eq("business_id", access.businessId).eq("id", invoiceId).eq("status", "draft");
  if (update.error) {
    if (!upload.error) await access.service.storage.from(POCKET_INVOICE_BUCKET).remove([path]);
    throw new Error(update.error.message);
  }
  if (invoice.logoObjectPath?.startsWith(`${access.businessId}/${invoiceId}/logo-`) && invoice.logoObjectPath !== path) {
    await access.service.storage.from(POCKET_INVOICE_BUCKET).remove([invoice.logoObjectPath]);
  }
  return { logoObjectPath: path };
}

export async function recordPocketInvoiceWhatsAppHandoff(access: PocketAccess, invoiceId: string, operationKey: string) {
  const { error } = await access.service.from("pocket_simple_invoice_events").insert({
    business_id: access.businessId, invoice_id: invoiceId, event_type: "whatsapp_handoff", actor_id: access.user.id,
    idempotency_key: operationKey, metadata: { delivery_status: "unknown", user_confirmation_required: true },
  });
  if (error && !error.message.toLowerCase().includes("duplicate")) throw new Error("The WhatsApp handoff could not be recorded.");
  return { handoffStatus: "prepared", deliveryStatus: "unknown" } as const;
}
