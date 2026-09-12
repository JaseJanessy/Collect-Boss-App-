import "server-only";

import { readSheet } from "read-excel-file/node";
import { normalizeCurrencyCode, parseCurrencyToMinor } from "@/lib/financial/money";
import type { AppSupabaseClient } from "@/lib/supabase/client";
import type { Json } from "@/lib/supabase/types";

export const importFields = [
  "debtor_type", "customer_name", "contact_name", "phone", "email", "address",
  "registration_no", "account_number", "account_name", "account_type",
  "obligation_type", "reference", "purchase_order_reference", "agreement_reference",
  "vehicle_registration", "currency", "opening_outstanding", "issue_date", "due_date", "priority",
] as const;
export type ImportField = typeof importFields[number];
export type ImportMapping = Partial<Record<ImportField, string>>;

const aliases: Record<ImportField, string[]> = {
  debtor_type: ["customer type", "debtor type", "type"],
  customer_name: ["customer name", "business name", "debtor name", "name"],
  contact_name: ["contact name", "contact person"],
  phone: ["phone", "phone number", "mobile"],
  email: ["email", "email address"],
  address: ["address", "customer address"],
  registration_no: ["registration no", "registration number", "ssm", "company reg"],
  account_number: ["account number", "account no", "customer account"],
  account_name: ["account name", "account display name"],
  account_type: ["account type"],
  obligation_type: ["obligation type", "record type", "invoice type"],
  reference: ["invoice reference", "invoice no", "invoice number", "reference"],
  purchase_order_reference: ["po", "po number", "purchase order", "purchase order reference"],
  agreement_reference: ["agreement", "agreement reference", "contract reference"],
  vehicle_registration: ["vehicle registration", "vehicle reg", "registration plate", "plate number"],
  currency: ["currency", "currency code", "iso currency"],
  opening_outstanding: ["opening outstanding", "outstanding", "amount due", "balance"],
  issue_date: ["issue date", "invoice date"],
  due_date: ["due date", "payment due"],
  priority: ["priority"],
};

export interface ImportSource {
  fileName: string;
  fileType: "csv" | "xlsx";
  headers: string[];
  rows: Array<Record<string, string>>;
}

export interface ImportValidationError {
  row_number: number;
  error_code: string;
  message: string;
  raw_row: Record<string, string>;
}

export interface ImportDuplicate {
  row_number: number;
  identifiers: string[];
  matched_customer_id: string | null;
  matched_customer_name: string | null;
  internal: boolean;
}

export interface NormalizedImportRow {
  row_number: number;
  debtor_type: "individual" | "business";
  customer_name: string;
  contact_name: string;
  phone: string;
  email: string;
  address: string;
  registration_no: string;
  account_number: string;
  account_name: string;
  account_type: string;
  obligation_type: string;
  reference: string;
  purchase_order_reference: string;
  issue_date: string;
  due_date: string;
  currency: string;
  opening_outstanding_minor: number;
  priority: "low" | "medium" | "high" | "urgent";
  matched_customer_id: string;
  reuse_confirmed: boolean;
  account_metadata: Json;
  obligation_metadata: Json;
}

function csvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field.");
  row.push(cell.replace(/\r$/, ""));
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function assertSafeXlsxArchive(buffer: Buffer) {
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) {
    throw new Error("The XLSX file is not a valid Office Open XML archive.");
  }
  let end = -1;
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 65_557); index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) { end = index; break; }
  }
  if (end < 0) throw new Error("The XLSX archive directory is missing.");
  const entries = buffer.readUInt16LE(end + 10);
  const directoryOffset = buffer.readUInt32LE(end + 16);
  if (entries > 5000 || directoryOffset >= buffer.length) throw new Error("The XLSX archive is too complex.");
  let offset = directoryOffset;
  let expanded = 0;
  for (let entry = 0; entry < entries; entry += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("The XLSX archive directory is invalid.");
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const compressed = buffer.readUInt32LE(offset + 20);
    const uncompressed = buffer.readUInt32LE(offset + 24);
    if ((flags & 1) !== 0) throw new Error("Encrypted XLSX files are not supported.");
    expanded += uncompressed;
    if (expanded > 50 * 1024 * 1024 || (compressed > 0 && uncompressed / compressed > 200)) {
      throw new Error("The XLSX archive expands beyond the safe import limit.");
    }
    offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
}

function cellText(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export async function parseImportFile(file: File): Promise<ImportSource> {
  const fileName = file.name.slice(0, 240);
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (file.size < 1 || file.size > 10 * 1024 * 1024 || !["csv", "xlsx"].includes(extension ?? "")) {
    throw new Error("Upload a CSV or XLSX file up to 10 MB.");
  }
  const bytes = await file.arrayBuffer();
  let matrix: string[][];
  if (extension === "csv") {
    matrix = csvRows(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
  } else {
    const buffer = Buffer.from(bytes);
    assertSafeXlsxArchive(buffer);
    matrix = (await readSheet(buffer)).map((row) => row.map(cellText));
  }
  if (matrix.length < 2) throw new Error("The import file must include a header and at least one data row.");
  if (matrix.length > 5001) throw new Error("A single import is limited to 5,000 data rows.");
  const headers = matrix[0].map((value, index) => cellText(value) || `Column ${index + 1}`);
  if (headers.length > 100) throw new Error("The import file has too many columns.");
  const duplicateHeaders = headers.filter((header, index) => headers.indexOf(header) !== index);
  if (duplicateHeaders.length) throw new Error(`Duplicate column heading: ${duplicateHeaders[0]}.`);
  const rows = matrix.slice(1).filter((row) => row.some((value) => cellText(value))).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, cellText(row[index])]))
  );
  if (!rows.length) throw new Error("The import file has no non-empty data rows.");
  return { fileName, fileType: extension as "csv" | "xlsx", headers, rows };
}

export function autoMapHeaders(headers: string[]): ImportMapping {
  const normalized = new Map(headers.map((header) => [header.trim().toLowerCase(), header]));
  return Object.fromEntries(importFields.flatMap((field) => {
    const header = aliases[field].map((alias) => normalized.get(alias)).find(Boolean);
    return header ? [[field, header]] : [];
  })) as ImportMapping;
}

function dateValue(value: string) {
  if (!value) return "";
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function normalizedPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 ? digits : "";
}

function normalizedRegistration(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

async function allTenantRows(client: AppSupabaseClient, table: string, businessId: string, columns: string) {
  const result: Record<string, unknown>[] = [];
  for (let from = 0; from < 10_000; from += 1000) {
    const { data, error } = await client.from(table).select(columns).eq("business_id", businessId)
      .is("archived_at", null).range(from, from + 999);
    if (error) throw new Error("Unable to check existing customer identifiers.");
    result.push(...((data ?? []) as unknown as Record<string, unknown>[]));
    if ((data ?? []).length < 1000) break;
  }
  return result;
}

export async function validateImport(
  client: AppSupabaseClient,
  businessId: string,
  source: ImportSource,
  mapping: ImportMapping,
) {
  const required: ImportField[] = ["customer_name", "reference", "opening_outstanding", "due_date"];
  for (const field of required) {
    if (!mapping[field] || !source.headers.includes(mapping[field]!)) {
      throw new Error(`Map the required ${field.replaceAll("_", " ")} column.`);
    }
  }
  for (const header of Object.values(mapping)) {
    if (header && !source.headers.includes(header)) throw new Error(`Mapped column "${header}" is missing.`);
  }
  const [debtors, accounts, businessResult] = await Promise.all([
    allTenantRows(client, "debtors", businessId, "id,individual_name,business_name,registration_no,phone,email"),
    allTenantRows(client, "customer_accounts", businessId, "customer_id,account_number,currency"),
    client.from("businesses").select("default_currency").eq("id", businessId).maybeSingle(),
  ]);
  if (businessResult.error) throw new Error("Unable to load the business currency configuration.");
  const defaultCurrency = normalizeCurrencyCode(String(businessResult.data?.default_currency ?? "MYR"));
  const tenantCurrencies = new Set(accounts.map((row) => normalizeCurrencyCode(String(row.currency ?? defaultCurrency))));
  if (tenantCurrencies.size > 1 && (!mapping.currency || !source.headers.includes(mapping.currency))) {
    throw new Error("Map the currency column because this business has more than one account currency.");
  }
  const existing = new Map<string, Array<{ id: string; name: string }>>();
  const add = (key: string, id: string, name: string) => {
    if (!key || key.endsWith(":")) return;
    existing.set(key, [...(existing.get(key) ?? []), { id, name }]);
  };
  for (const row of debtors) {
    const id = String(row.id);
    const name = String(row.business_name || row.individual_name || "Customer");
    add(`reg:${normalizedRegistration(String(row.registration_no ?? ""))}`, id, name);
    add(`email:${String(row.email ?? "").trim().toLowerCase()}`, id, name);
    add(`phone:${normalizedPhone(String(row.phone ?? ""))}`, id, name);
  }
  for (const row of accounts) add(`account:${String(row.account_number ?? "").trim().toLowerCase()}`, String(row.customer_id), "Existing account customer");

  const errors: ImportValidationError[] = [];
  const duplicates: ImportDuplicate[] = [];
  const normalizedRows: NormalizedImportRow[] = [];
  const internalKeys = new Map<string, number>();
  const value = (raw: Record<string, string>, field: ImportField) => mapping[field] ? raw[mapping[field]!] ?? "" : "";

  source.rows.forEach((raw, index) => {
    const rowNumber = index + 2;
    const rowErrors: string[] = [];
    const name = value(raw, "customer_name").trim();
    const reference = value(raw, "reference").trim();
    const dueDate = dateValue(value(raw, "due_date"));
    let currency = defaultCurrency;
    let amountMinor = 0;
    try {
      const rawCurrency = value(raw, "currency").trim();
      if (!rawCurrency && tenantCurrencies.size > 1) throw new Error("Currency is required.");
      currency = normalizeCurrencyCode(rawCurrency || (tenantCurrencies.size === 1 ? [...tenantCurrencies][0]! : defaultCurrency));
      const parsed = parseCurrencyToMinor(value(raw, "opening_outstanding"), currency);
      if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Amount is too large.");
      amountMinor = Number(parsed);
    } catch { rowErrors.push("Enter a valid positive opening outstanding amount."); }
    if (!name) rowErrors.push("Customer name is required.");
    if (!reference) rowErrors.push("Invoice or obligation reference is required.");
    if (!dueDate) rowErrors.push("Enter a valid due date.");
    if (amountMinor <= 0) rowErrors.push("Opening outstanding must be greater than zero.");
    const email = value(raw, "email").trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) rowErrors.push("Email address is invalid.");
    const rawType = value(raw, "debtor_type").trim().toLowerCase();
    const debtorType = rawType === "individual" ? "individual" : "business";
    if (rawType && !["individual", "business"].includes(rawType)) rowErrors.push("Customer type must be individual or business.");
    const priorityRaw = value(raw, "priority").trim().toLowerCase() || "medium";
    const priority = ["low", "medium", "high", "urgent"].includes(priorityRaw)
      ? priorityRaw as NormalizedImportRow["priority"] : "medium";
    if (priorityRaw !== priority) rowErrors.push("Priority must be low, medium, high or urgent.");
    const accountType = value(raw, "account_type").trim().toLowerCase() || "general";
    if (!["general", "corporate", "supplier", "rental", "vehicle", "property", "project", "catering_event", "future"].includes(accountType)) {
      rowErrors.push("Account type is invalid.");
    }
    const obligationType = value(raw, "obligation_type").trim().toLowerCase() || "invoice";
    if (!["invoice", "general_obligation", "rent", "vehicle", "property", "project", "supplier", "catering_event", "other"].includes(obligationType)) {
      rowErrors.push("Obligation type is invalid.");
    }
    if (rowErrors.length) {
      errors.push({ row_number: rowNumber, error_code: "VALIDATION", message: rowErrors.join(" "), raw_row: raw });
      return;
    }

    const keys = [
      normalizedRegistration(value(raw, "registration_no")) ? `reg:${normalizedRegistration(value(raw, "registration_no"))}` : "",
      email ? `email:${email}` : "",
      normalizedPhone(value(raw, "phone")) ? `phone:${normalizedPhone(value(raw, "phone"))}` : "",
      value(raw, "account_number").trim() ? `account:${value(raw, "account_number").trim().toLowerCase()}` : "",
    ].filter(Boolean);
    const candidates = new Map<string, string>();
    keys.flatMap((key) => existing.get(key) ?? []).forEach((candidate) => candidates.set(candidate.id, candidate.name));
    if (candidates.size > 1) {
      errors.push({
        row_number: rowNumber, error_code: "AMBIGUOUS_DUPLICATE",
        message: "Reliable identifiers match more than one existing customer. Resolve the duplicates before import.", raw_row: raw,
      });
      return;
    }
    const internal = keys.some((key) => internalKeys.has(key));
    const match = [...candidates.entries()][0];
    if (match || internal) {
      duplicates.push({
        row_number: rowNumber, identifiers: keys, matched_customer_id: match?.[0] ?? null,
        matched_customer_name: match?.[1] ?? null, internal,
      });
    }
    keys.forEach((key) => internalKeys.set(key, rowNumber));
    normalizedRows.push({
      row_number: rowNumber,
      debtor_type: debtorType,
      customer_name: name,
      contact_name: value(raw, "contact_name").trim(),
      phone: value(raw, "phone").trim(),
      email,
      address: value(raw, "address").trim(),
      registration_no: value(raw, "registration_no").trim(),
      account_number: value(raw, "account_number").trim(),
      account_name: value(raw, "account_name").trim(),
      account_type: accountType,
      obligation_type: obligationType,
      reference,
      purchase_order_reference: value(raw, "purchase_order_reference").trim(),
      issue_date: dateValue(value(raw, "issue_date")),
      due_date: dueDate,
      currency,
      opening_outstanding_minor: amountMinor,
      priority,
      matched_customer_id: match?.[0] ?? "",
      reuse_confirmed: Boolean(match || internal),
      account_metadata: {
        vehicle_registration: value(raw, "vehicle_registration").trim() || null,
      },
      obligation_metadata: {
        agreement_reference: value(raw, "agreement_reference").trim() || null,
        vehicle_registration: value(raw, "vehicle_registration").trim() || null,
      },
    });
  });
  return { errors, duplicates, normalizedRows };
}

export function importTemplateCsv() {
  const headers = [
    "Customer Type", "Customer Name", "Contact Name", "Phone", "Email", "Address",
    "Registration Number", "Account Number", "Account Name", "Account Type",
    "Obligation Type", "Invoice Reference", "Purchase Order Reference", "Agreement Reference",
    "Vehicle Registration", "Currency", "Opening Outstanding", "Issue Date", "Due Date", "Priority",
  ];
  const example = [
    "business", "Example Trading Sdn Bhd", "Accounts Payable", "+60123456789",
    "accounts@example.test", "Kuala Lumpur", "202601234567", "AC-1001",
    "Example Trading", "corporate", "invoice", "INV-1001", "PO-9001", "AGR-2026-01",
    "VAA1234", "MYR", "12500.00", "2026-06-01", "2026-07-01", "high",
  ];
  return "\uFEFF" + [headers, example].map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\r\n");
}
