import "server-only";

import type { AccountingAdapter, AccountingPage, NormalizedContact, NormalizedInvoice } from "../types";
import { fetchJson, isoDate, isoInstant, minor, nullableText, record, records, text } from "./shared";

/**
 * Bukku (bukku.my) — Malaysian cloud accounting. The business turns on API
 * access in Control Panel → Integrations and gives CollectBoss its access
 * token and company subdomain. Read-only: customers and sales invoices.
 * Spec: https://developers.bukku.my (servers, Bearer token, Company-Subdomain header).
 */

const BASE_URL = process.env.BUKKU_API_BASE_URL?.trim() || "https://api.bukku.my";
const PAGE_SIZE = 50;
const PAID_LOOKBACK_DAYS = 90;

function headers(accessToken: string, subdomain: string) {
  return { Authorization: `Bearer ${accessToken}`, "Company-Subdomain": subdomain, Accept: "application/json" };
}

function unsupported(): never {
  throw new Error("Bukku connects with an API access token from Bukku → Control Panel → Integrations.");
}

async function get(accessToken: string, subdomain: string, path: string, params: Record<string, string>) {
  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return record(await fetchJson(url.toString(), { headers: headers(accessToken, subdomain) }, `Bukku ${path}`));
}

export function mapBukkuContact(item: Record<string, unknown>): NormalizedContact | null {
  const id = text(item.id);
  const types = Array.isArray(item.types) ? item.types.map(String) : ["customer"];
  if (!id || !types.includes("customer")) return null;
  return {
    kind: "contact",
    externalId: id,
    version: nullableText(item.updated_at),
    updatedAt: isoInstant(item.updated_at),
    status: item.is_archived === true ? "archived" : "active",
    name: text(item.legal_name) || text(item.other_name) || text(item.display_name) || `Bukku contact ${id}`,
    contactName: nullableText(item.other_name),
    email: nullableText(item.email),
    phone: nullableText(item.phone_no),
    address: nullableText(item.billing_address ?? item.address),
    registrationNumber: nullableText(item.reg_no),
    accountNumber: nullableText(item.contact_code),
    currency: nullableText(item.default_currency_code ?? item.currency_code),
  };
}

export function mapBukkuInvoice(item: Record<string, unknown>): NormalizedInvoice | null {
  const id = text(item.id);
  const contactId = text(item.contact_id);
  if (!id || !contactId) return null;
  const totalMinor = minor(item.amount);
  const outstandingMinor = item.balance === undefined || item.balance === null ? totalMinor : minor(item.balance);
  const terms = records(item.term_items);
  const dueDate = terms.map((term) => isoDate(term.date)).filter((value): value is string => Boolean(value)).sort().pop()
    ?? isoDate(item.date)
    ?? new Date().toISOString().slice(0, 10);
  const status = text(item.status);
  return {
    kind: "invoice",
    externalId: id,
    contactExternalId: contactId,
    version: nullableText(item.updated_at),
    updatedAt: isoInstant(item.updated_at),
    status: status === "void" ? "void" : status === "draft" ? "draft" : outstandingMinor === 0 ? "paid" : "open",
    reference: text(item.number) || `BUKKU-${id}`,
    purchaseOrderReference: nullableText(item.number2),
    issueDate: isoDate(item.date),
    dueDate,
    currency: text(item.currency_code) || "MYR",
    totalMinor,
    paidMinor: Math.max(0, totalMinor - outstandingMinor),
    creditedMinor: 0,
    outstandingMinor,
  };
}

/** Cursor format: "<phase>:<page>" where phase is "outstanding" then "paid". */
function parseCursor(cursor: string | null): { phase: "outstanding" | "paid"; page: number } {
  const [phase, page] = (cursor ?? "outstanding:1").split(":");
  return { phase: phase === "paid" ? "paid" : "outstanding", page: Math.max(1, Number(page) || 1) };
}

export const bukkuAdapter: AccountingAdapter = {
  provider: "bukku",
  credentialMode: "api_key",
  capabilities: { contacts: "read", invoices: "read", payments: "read", creditNotes: "read", incremental: "poll", writeBack: false },
  requiredScopes: [],
  getAuthorizationUrl: unsupported,
  exchangeAuthorizationCode: async () => unsupported(),
  refreshTokens: async () => unsupported(),
  async revoke() {
    // Tokens are revoked by the business in Bukku; nothing to call.
  },
  async getOrganization(accessToken, subdomainHint) {
    const subdomain = subdomainHint?.trim().toLowerCase() ?? "";
    if (!/^[a-z0-9-]{2,63}$/.test(subdomain)) throw new Error("Enter your Bukku company subdomain, for example mycompany.");
    // A one-record read proves the token and subdomain work together.
    await get(accessToken, subdomain, "/contacts", { page: "1", page_size: "1" });
    return { externalTenantId: subdomain, name: `${subdomain}.bukku.my`, countryCode: "MY", baseCurrency: "MYR" };
  },
  async fetchPage({ accessToken, externalTenantId, kind, cursor, modifiedSince }): Promise<AccountingPage> {
    if (kind === "payment" || kind === "credit_note") return { records: [], nextCursor: null };

    if (kind === "contact") {
      const page = Math.max(1, Number(cursor) || 1);
      const body = await get(accessToken, externalTenantId, "/contacts", { page: String(page), page_size: String(PAGE_SIZE) });
      const items = records(body.contacts);
      const paging = record(body.paging);
      const more = page * PAGE_SIZE < (Number(paging.total) || 0);
      return { records: items.map(mapBukkuContact).filter((item): item is NormalizedContact => item !== null), nextCursor: more ? String(page + 1) : null };
    }

    const { phase, page } = parseCursor(cursor);
    const params: Record<string, string> = { page: String(page), page_size: String(PAGE_SIZE), status: "ready" };
    if (phase === "outstanding") {
      params.payment_status = "OUTSTANDING";
    } else {
      params.payment_status = "PAID";
      const since = modifiedSince ? new Date(modifiedSince) : new Date();
      since.setUTCDate(since.getUTCDate() - PAID_LOOKBACK_DAYS);
      params.date_from = since.toISOString().slice(0, 10);
    }
    const body = await get(accessToken, externalTenantId, "/sales/invoices", params);
    const listed = records(body.transactions);
    const paging = record(body.paging);
    const more = page * PAGE_SIZE < (Number(paging.total) || 0);

    // Outstanding invoices need the detail record for balance and due date.
    const detailed = phase === "outstanding"
      ? await Promise.all(listed.map(async (item) => {
        const detail = await get(accessToken, externalTenantId, `/sales/invoices/${encodeURIComponent(text(item.id))}`, {});
        return { ...item, ...record(detail.transaction) };
      }))
      : listed.map((item) => ({ ...item, balance: 0 }));

    const nextCursor = more ? `${phase}:${page + 1}` : phase === "outstanding" ? "paid:1" : null;
    return { records: detailed.map(mapBukkuInvoice).filter((item): item is NormalizedInvoice => item !== null), nextCursor };
  },
};
