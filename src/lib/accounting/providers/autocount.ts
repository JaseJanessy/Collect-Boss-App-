import "server-only";

import type { AccountingAdapter, AccountingPage, NormalizedContact, NormalizedInvoice } from "../types";
import { fetchJson, isoDate, isoInstant, minor, nullableText, record, records, text } from "./shared";

/**
 * AutoCount Cloud Accounting. The business creates an API key in
 * Settings → API Keys and gives CollectBoss the Key ID, API Key and its
 * account book ID. Read-only: debtors (customers) and invoices.
 * Docs: https://accounting-api.autocountcloud.com/documentation/
 */

const BASE_URL = process.env.AUTOCOUNT_API_BASE_URL?.trim() || "https://accounting-api.autocountcloud.com";

export interface AutoCountCredentials { keyId: string; apiKey: string }

export function parseAutoCountCredentials(accessToken: string): AutoCountCredentials {
  try {
    const parsed = JSON.parse(accessToken) as Partial<AutoCountCredentials>;
    if (parsed.keyId && parsed.apiKey) return { keyId: parsed.keyId, apiKey: parsed.apiKey };
  } catch {
    // fall through
  }
  throw new Error("AutoCount credentials are incomplete. Reconnect with your Key ID and API Key.");
}

function unsupported(): never {
  throw new Error("AutoCount connects with an API key from AutoCount Cloud Accounting → Settings → API Keys.");
}

/** AutoCount examples use both PascalCase and camelCase; read either. */
function field(item: Record<string, unknown>, name: string): unknown {
  if (name in item) return item[name];
  const lower = name.toLowerCase();
  const key = Object.keys(item).find((candidate) => candidate.toLowerCase() === lower);
  return key ? item[key] : undefined;
}

async function call(accessToken: string, accountBookId: string, path: string, init: { method: "GET" | "POST"; query?: Record<string, string | string[]>; body?: unknown }) {
  const credentials = parseAutoCountCredentials(accessToken);
  const url = new URL(`/${encodeURIComponent(accountBookId)}${path}`, BASE_URL);
  for (const [key, value] of Object.entries(init.query ?? {})) {
    for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, item);
  }
  return record(await fetchJson(url.toString(), {
    method: init.method,
    headers: { "Key-ID": credentials.keyId, "API-Key": credentials.apiKey, "Content-Type": "application/json", Accept: "application/json" },
    // AutoCount requires at least an empty JSON object on body requests.
    body: init.method === "POST" ? JSON.stringify(init.body ?? {}) : undefined,
  }, `AutoCount ${path}`));
}

export function mapAutoCountDebtor(item: Record<string, unknown>): NormalizedContact | null {
  const accNo = text(field(item, "accNo"));
  if (!accNo) return null;
  return {
    kind: "contact",
    externalId: accNo,
    version: null,
    updatedAt: null,
    status: field(item, "isActive") === false ? "archived" : "active",
    name: text(field(item, "companyName")) || accNo,
    contactName: nullableText(field(item, "attention")),
    email: nullableText(field(item, "emailAddress")),
    phone: nullableText(field(item, "phone1")) ?? nullableText(field(item, "phone2")),
    address: nullableText(field(item, "address")),
    registrationNumber: nullableText(field(item, "registerNo")),
    accountNumber: accNo,
    currency: nullableText(field(item, "currencyCode")),
  };
}

export function mapAutoCountInvoice(row: Record<string, unknown>): NormalizedInvoice | null {
  const master = record(field(row, "master") ?? row);
  const docNo = text(field(master, "docNo"));
  const debtorCode = text(field(master, "debtorCode"));
  if (!docNo || !debtorCode) return null;
  const totalMinor = minor(field(master, "finalTotal") ?? field(master, "netTotal"));
  const outstandingMinor = minor(field(master, "outstandingAmount"));
  const cancelled = field(master, "cancelled") === true;
  return {
    kind: "invoice",
    externalId: text(field(master, "docKey")) || docNo,
    contactExternalId: debtorCode,
    version: nullableText(field(master, "lastModified")),
    updatedAt: isoInstant(field(master, "lastModified")),
    status: cancelled ? "void" : outstandingMinor === 0 ? "paid" : "open",
    reference: docNo,
    purchaseOrderReference: null,
    issueDate: isoDate(field(master, "docDate")),
    dueDate: isoDate(field(master, "dueDate")) ?? isoDate(field(master, "docDate")) ?? new Date().toISOString().slice(0, 10),
    currency: text(field(master, "currencyCode")) || "MYR",
    totalMinor,
    paidMinor: Math.max(0, totalMinor - outstandingMinor),
    creditedMinor: 0,
    outstandingMinor,
  };
}

const DEBTOR_FIELDS = ["companyName", "attention", "phone1", "phone2", "emailAddress", "address", "registerNo", "currencyCode", "isActive"];

export const autoCountAdapter: AccountingAdapter = {
  provider: "autocount",
  credentialMode: "api_key",
  capabilities: { contacts: "read", invoices: "read", payments: "read", creditNotes: "read", incremental: "poll", writeBack: false },
  requiredScopes: [],
  getAuthorizationUrl: unsupported,
  exchangeAuthorizationCode: async () => unsupported(),
  refreshTokens: async () => unsupported(),
  async revoke() {
    // API keys are removed by the business in AutoCount; nothing to call.
  },
  async getOrganization(accessToken, accountBookHint) {
    const accountBookId = accountBookHint?.trim() ?? "";
    if (!/^\d{1,12}$/.test(accountBookId)) throw new Error("Enter your AutoCount account book ID (a number).");
    await call(accessToken, accountBookId, "/debtor/listing", { method: "GET", query: { page: "1", activeOnly: "false" } });
    return { externalTenantId: accountBookId, name: `AutoCount account book ${accountBookId}`, countryCode: "MY", baseCurrency: "MYR" };
  },
  async fetchPage({ accessToken, externalTenantId, kind, cursor, modifiedSince }): Promise<AccountingPage> {
    if (kind === "payment" || kind === "credit_note") return { records: [], nextCursor: null };
    const page = Math.max(1, Number(cursor) || 1);

    if (kind === "contact") {
      const body = await call(accessToken, externalTenantId, "/debtor/listing", {
        method: "GET", query: { page: String(page), activeOnly: "false", field: DEBTOR_FIELDS },
      });
      const items = records(body.data);
      const seen = (page - 1) * 100 + items.length;
      return {
        records: items.map(mapAutoCountDebtor).filter((item): item is NormalizedContact => item !== null),
        nextCursor: items.length > 0 && seen < (Number(body.totalCount) || 0) ? String(page + 1) : null,
      };
    }

    const filter = modifiedSince
      ? { lastModifiedDate: { from: modifiedSince.slice(0, 10), to: new Date().toISOString().slice(0, 10) } }
      : {};
    const body = await call(accessToken, externalTenantId, "/invoice/listing", { method: "POST", body: { page, filter } });
    const items = records(body.data);
    const total = Number(body.totalCount) || 0;
    const pageSize = page === 1 ? Math.max(items.length, 1) : 100;
    return {
      records: items.map(mapAutoCountInvoice).filter((item): item is NormalizedInvoice => item !== null),
      nextCursor: items.length > 0 && (page - 1) * pageSize + items.length < total ? String(page + 1) : null,
    };
  },
};
