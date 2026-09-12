import "server-only";

import type {
  AccountingAdapter, AccountingEntityKind, AccountingPage, AccountingPaymentAllocationWriteback, AccountingTokens,
  NormalizedAccountingRecord,
} from "../types";
import {
  fetchJson, isoDate, isoInstant, minor, nullableText, numeric, record, records,
  requiredEnvironment, text, tokenExpiry,
} from "./shared";
import { minorToMajorNumber } from "@/lib/financial/money";

const AUTHORIZE_URL = "https://login.xero.com/identity/connect/authorize";
const TOKEN_URL = "https://identity.xero.com/connect/token";
const CONNECTIONS_URL = "https://api.xero.com/connections";
const ACCOUNTING_URL = "https://api.xero.com/api.xro/2.0";
const SCOPES = ["openid", "profile", "email", "offline_access", "accounting.transactions", "accounting.contacts"];

function credentials() {
  return {
    clientId: requiredEnvironment("XERO_CLIENT_ID"),
    clientSecret: requiredEnvironment("XERO_CLIENT_SECRET"),
  };
}

async function tokenRequest(parameters: URLSearchParams): Promise<AccountingTokens> {
  const { clientId, clientSecret } = credentials();
  const response = record(await fetchJson(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: parameters,
  }, "Xero OAuth token exchange"));
  const accessToken = text(response.access_token);
  const refreshToken = text(response.refresh_token);
  if (!accessToken || !refreshToken) throw new Error("Xero returned an incomplete OAuth token response.");
  return {
    accessToken,
    refreshToken,
    expiresAt: tokenExpiry(response.expires_in),
    scopes: text(response.scope).split(/\s+/).filter(Boolean),
  };
}

function xeroHeaders(accessToken: string, tenantId: string, modifiedSince?: string | null) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Xero-tenant-id": tenantId,
    Accept: "application/json",
    ...(modifiedSince ? { "If-Modified-Since": modifiedSince } : {}),
  };
}

function xeroContact(row: Record<string, unknown>): NormalizedAccountingRecord | null {
  const id = text(row.ContactID);
  const name = text(row.Name);
  if (!id || !name) return null;
  const phones = records(row.Phones);
  const phone = phones.map((item) => text(item.PhoneNumber)).find(Boolean) ?? null;
  const addresses = records(row.Addresses);
  const address = addresses.map((item) => [item.AddressLine1, item.AddressLine2, item.City, item.Region, item.PostalCode, item.Country]
    .map(text).filter(Boolean).join(", ")).find(Boolean) ?? null;
  return {
    kind: "contact", externalId: id, version: isoInstant(row.UpdatedDateUTC),
    updatedAt: isoInstant(row.UpdatedDateUTC), status: text(row.ContactStatus) === "ARCHIVED" ? "archived" : "active",
    name, contactName: [text(row.FirstName), text(row.LastName)].filter(Boolean).join(" ") || null,
    email: nullableText(row.EmailAddress), phone, address,
    registrationNumber: nullableText(row.CompanyNumber), accountNumber: nullableText(row.AccountNumber),
    currency: nullableText(row.DefaultCurrency),
  };
}

function xeroInvoice(row: Record<string, unknown>): NormalizedAccountingRecord | null {
  const id = text(row.InvoiceID);
  const contactId = text(record(row.Contact).ContactID);
  const reference = text(row.InvoiceNumber) || text(row.Reference);
  const dueDate = isoDate(row.DueDate);
  if (!id || !contactId || !reference || !dueDate) return null;
  const statusText = text(row.Status);
  const status = statusText === "DELETED" || statusText === "VOIDED" ? "void"
    : statusText === "DRAFT" || statusText === "SUBMITTED" ? "draft"
    : statusText === "PAID" ? "paid" : "open";
  return {
    kind: "invoice", externalId: id, contactExternalId: contactId,
    version: isoInstant(row.UpdatedDateUTC), updatedAt: isoInstant(row.UpdatedDateUTC), status,
    reference, purchaseOrderReference: nullableText(row.Reference), issueDate: isoDate(row.Date), dueDate,
    currency: text(row.CurrencyCode) || "MYR", totalMinor: minor(row.Total), paidMinor: minor(row.AmountPaid),
    creditedMinor: minor(row.AmountCredited), outstandingMinor: minor(row.AmountDue),
  };
}

function xeroPayment(row: Record<string, unknown>): NormalizedAccountingRecord | null {
  const id = text(row.PaymentID);
  if (!id) return null;
  return {
    kind: "payment", externalId: id, invoiceExternalId: nullableText(record(row.Invoice).InvoiceID),
    version: isoInstant(row.UpdatedDateUTC), updatedAt: isoInstant(row.UpdatedDateUTC),
    status: text(row.Status) === "DELETED" ? "reversed" : "active", amountMinor: minor(row.Amount),
    currency: nullableText(record(row.Invoice).CurrencyCode), occurredOn: isoDate(row.Date), reference: nullableText(row.Reference),
  };
}

function xeroCredits(row: Record<string, unknown>): NormalizedAccountingRecord[] {
  const creditId = text(row.CreditNoteID);
  if (!creditId) return [];
  const status = text(row.Status) === "DELETED" || text(row.Status) === "VOIDED" ? "void" : "active";
  const allocations = records(row.Allocations);
  if (!allocations.length) {
    return [{
      kind: "credit_note", externalId: creditId, invoiceExternalId: null,
      version: isoInstant(row.UpdatedDateUTC), updatedAt: isoInstant(row.UpdatedDateUTC), status,
      amountMinor: minor(numeric(row.Total) - numeric(row.RemainingCredit)), currency: nullableText(row.CurrencyCode),
      occurredOn: isoDate(row.Date), reference: nullableText(row.CreditNoteNumber),
    }];
  }
  return allocations.map((allocation, index) => ({
    kind: "credit_note" as const,
    externalId: text(allocation.AllocationID) || `${creditId}:${text(record(allocation.Invoice).InvoiceID) || index}`,
    invoiceExternalId: nullableText(record(allocation.Invoice).InvoiceID),
    version: isoInstant(row.UpdatedDateUTC), updatedAt: isoInstant(row.UpdatedDateUTC), status,
    amountMinor: minor(allocation.Amount), currency: nullableText(row.CurrencyCode),
    occurredOn: isoDate(allocation.Date) ?? isoDate(row.Date), reference: nullableText(row.CreditNoteNumber),
  }));
}

function endpoint(kind: AccountingEntityKind) {
  return { contact: "Contacts", invoice: "Invoices", payment: "Payments", credit_note: "CreditNotes" }[kind];
}

export const xeroAdapter: AccountingAdapter = {
  provider: "xero",
  requiredScopes: SCOPES,
  capabilities: {
    contacts: "read", invoices: "read", payments: "read", creditNotes: "read",
    incremental: "webhook_and_poll", writeBack: true,
  },
  getAuthorizationUrl({ state, redirectUri }) {
    const { clientId } = credentials();
    const url = new URL(AUTHORIZE_URL);
    url.search = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, scope: SCOPES.join(" "), state }).toString();
    return url.toString();
  },
  exchangeAuthorizationCode({ code, redirectUri }) {
    return tokenRequest(new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }));
  },
  refreshTokens(refreshToken) {
    return tokenRequest(new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }));
  },
  async revoke(refreshToken) {
    const { clientId, clientSecret } = credentials();
    await fetchJson("https://identity.xero.com/connect/revocation", {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }),
    }, "Xero token revocation");
  },
  async getOrganization(accessToken, hint) {
    const connections = records(await fetchJson(CONNECTIONS_URL, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } }, "Xero connections lookup"));
    const selected = connections.find((item) => text(item.tenantId) === hint) ?? connections[0];
    const tenantId = text(selected?.tenantId);
    if (!tenantId) throw new Error("No Xero organisation was authorized.");
    const organizationResponse = record(await fetchJson(`${ACCOUNTING_URL}/Organisation`, { headers: xeroHeaders(accessToken, tenantId) }, "Xero organisation lookup"));
    const organization = records(organizationResponse.Organisations)[0] ?? {};
    return {
      externalTenantId: tenantId,
      name: text(organization.Name) || text(selected.tenantName) || "Xero organisation",
      countryCode: nullableText(organization.CountryCode), baseCurrency: nullableText(organization.BaseCurrency),
    };
  },
  async fetchPage({ accessToken, externalTenantId, kind, cursor, modifiedSince }): Promise<AccountingPage> {
    const page = Math.max(1, Number(cursor) || 1);
    const url = new URL(`${ACCOUNTING_URL}/${endpoint(kind)}`);
    url.searchParams.set("page", String(page));
    if (kind === "invoice") url.searchParams.set("where", 'Type=="ACCREC"');
    if (kind === "credit_note") url.searchParams.set("where", 'Type=="ACCRECCREDIT"');
    const response = record(await fetchJson(url.toString(), { headers: xeroHeaders(accessToken, externalTenantId, modifiedSince) }, `Xero ${kind} sync`));
    const key = endpoint(kind);
    const source = records(response[key]);
    const normalized = source.flatMap((item) => {
      if (kind === "contact") return xeroContact(item) ?? [];
      if (kind === "invoice") return xeroInvoice(item) ?? [];
      if (kind === "payment") return xeroPayment(item) ?? [];
      return xeroCredits(item);
    });
    return { records: normalized, nextCursor: source.length >= 100 ? String(page + 1) : null };
  },
  async createPaymentAllocation(accessToken: string, externalTenantId: string, input: AccountingPaymentAllocationWriteback) {
    const response = record(await fetchJson(`${ACCOUNTING_URL}/Payments`, {
      method: "PUT",
      headers: { ...xeroHeaders(accessToken, externalTenantId), "Content-Type": "application/json", "Idempotency-Key": input.idempotencyKey },
      body: JSON.stringify({ Payments: [{ Invoice: { InvoiceID: input.externalInvoiceId }, Account: { AccountID: input.cashAccountId }, Amount: minorToMajorNumber(input.amountMinor, input.currency), Date: input.occurredOn, Reference: input.reference ?? input.idempotencyKey }] }),
    }, "Xero payment allocation write-back"));
    const externalRecordId = text(records(response.Payments)[0]?.PaymentID);
    if (!externalRecordId) throw new Error("Xero payment write-back returned no payment identifier.");
    return { externalRecordId };
  },
};
