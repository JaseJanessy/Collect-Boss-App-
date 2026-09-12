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
import { isProduction } from "@/lib/supabase/client";

const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
const ACCOUNTING_SCOPE = "com.intuit.quickbooks.accounting";

function credentials() {
  return {
    clientId: requiredEnvironment("QUICKBOOKS_CLIENT_ID"),
    clientSecret: requiredEnvironment("QUICKBOOKS_CLIENT_SECRET"),
  };
}

function apiBase() {
  const environment = process.env.QUICKBOOKS_ENVIRONMENT?.trim().toLowerCase();
  if (environment !== "sandbox" && environment !== "production") {
    throw new Error("QUICKBOOKS_ENVIRONMENT must be explicitly set to sandbox or production.");
  }
  if (isProduction && environment !== "production") {
    throw new Error("Production cannot use the QuickBooks sandbox environment.");
  }
  if (!isProduction && environment === "production") {
    throw new Error("Non-production environments cannot use the QuickBooks production API.");
  }
  return environment === "sandbox"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
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
  }, "QuickBooks OAuth token exchange"));
  const accessToken = text(response.access_token);
  const refreshToken = text(response.refresh_token);
  if (!accessToken || !refreshToken) throw new Error("QuickBooks returned an incomplete OAuth token response.");
  return {
    accessToken, refreshToken, expiresAt: tokenExpiry(response.expires_in),
    scopes: text(response.scope).split(/\s+/).filter(Boolean),
  };
}

function qbVersion(row: Record<string, unknown>) {
  return text(record(row.MetaData).LastUpdatedTime) || text(row.SyncToken) || null;
}

function qbUpdated(row: Record<string, unknown>) {
  return isoInstant(record(row.MetaData).LastUpdatedTime);
}

function qbAddress(row: Record<string, unknown>) {
  const address = record(row.BillAddr);
  return [address.Line1, address.Line2, address.Line3, address.City, address.CountrySubDivisionCode, address.PostalCode, address.Country]
    .map(text).filter(Boolean).join(", ") || null;
}

function qbContact(row: Record<string, unknown>): NormalizedAccountingRecord | null {
  const id = text(row.Id);
  const name = text(row.DisplayName) || text(row.CompanyName);
  if (!id || !name) return null;
  return {
    kind: "contact", externalId: id, version: qbVersion(row), updatedAt: qbUpdated(row),
    status: row.Active === false ? "archived" : "active", name,
    contactName: [text(row.GivenName), text(row.FamilyName)].filter(Boolean).join(" ") || null,
    email: nullableText(record(row.PrimaryEmailAddr).Address), phone: nullableText(record(row.PrimaryPhone).FreeFormNumber),
    address: qbAddress(row), registrationNumber: nullableText(row.TaxIdentifier),
    accountNumber: nullableText(row.AcctNum), currency: nullableText(record(row.CurrencyRef).value),
  };
}

function qbInvoice(row: Record<string, unknown>): NormalizedAccountingRecord | null {
  const id = text(row.Id);
  const contactId = text(record(row.CustomerRef).value);
  const reference = text(row.DocNumber) || `QBO-${id}`;
  const dueDate = isoDate(row.DueDate) ?? isoDate(row.TxnDate);
  if (!id || !contactId || !dueDate) return null;
  const totalMinor = minor(row.TotalAmt);
  const outstandingMinor = Math.min(totalMinor, minor(row.Balance));
  return {
    kind: "invoice", externalId: id, contactExternalId: contactId,
    version: qbVersion(row), updatedAt: qbUpdated(row), status: row.PrivateNote === "CollectBoss:void" ? "void" : outstandingMinor === 0 ? "paid" : "open",
    reference, purchaseOrderReference: nullableText(row.PONumber), issueDate: isoDate(row.TxnDate), dueDate,
    currency: text(record(row.CurrencyRef).value) || "MYR", totalMinor,
    // QBO's invoice Balance is authoritative. Payment and credit entities are
    // still imported separately so linked recovery cases retain cash/credit semantics.
    paidMinor: Math.max(0, totalMinor - outstandingMinor), creditedMinor: 0, outstandingMinor,
  };
}

function linkedTransactions(row: Record<string, unknown>) {
  const lines = records(row.Line);
  const fromLines = lines.flatMap((line) => records(line.LinkedTxn).map((link) => ({ link, amount: line.Amount })));
  const topLevel = records(row.LinkedTxn).map((link) => ({ link, amount: row.TotalAmt }));
  return [...fromLines, ...topLevel].filter(({ link }) => text(link.TxnType) === "Invoice" && text(link.TxnId));
}

function qbPayments(row: Record<string, unknown>): NormalizedAccountingRecord[] {
  const paymentId = text(row.Id);
  if (!paymentId) return [];
  const links = linkedTransactions(row);
  if (!links.length) {
    return [{
      kind: "payment", externalId: paymentId, invoiceExternalId: null,
      version: qbVersion(row), updatedAt: qbUpdated(row), status: row.status === "Deleted" ? "reversed" : "active",
      amountMinor: minor(row.TotalAmt), currency: nullableText(record(row.CurrencyRef).value),
      occurredOn: isoDate(row.TxnDate), reference: nullableText(row.PaymentRefNum),
    }];
  }
  return links.map(({ link, amount }) => ({
    kind: "payment" as const, externalId: `${paymentId}:${text(link.TxnId)}`,
    invoiceExternalId: text(link.TxnId), version: qbVersion(row), updatedAt: qbUpdated(row),
    status: row.status === "Deleted" ? "reversed" as const : "active" as const,
    amountMinor: minor(amount || numeric(row.TotalAmt) / links.length),
    currency: nullableText(record(row.CurrencyRef).value), occurredOn: isoDate(row.TxnDate), reference: nullableText(row.PaymentRefNum),
  }));
}

function qbCredits(row: Record<string, unknown>): NormalizedAccountingRecord[] {
  const creditId = text(row.Id);
  if (!creditId) return [];
  const links = linkedTransactions(row);
  const status = row.status === "Deleted" ? "void" as const : "active" as const;
  if (!links.length) {
    return [{
      kind: "credit_note", externalId: creditId, invoiceExternalId: null,
      version: qbVersion(row), updatedAt: qbUpdated(row), status,
      amountMinor: minor(numeric(row.TotalAmt) - numeric(row.RemainingCredit)),
      currency: nullableText(record(row.CurrencyRef).value), occurredOn: isoDate(row.TxnDate), reference: nullableText(row.DocNumber),
    }];
  }
  return links.map(({ link, amount }) => ({
    kind: "credit_note" as const, externalId: `${creditId}:${text(link.TxnId)}`,
    invoiceExternalId: text(link.TxnId), version: qbVersion(row), updatedAt: qbUpdated(row), status,
    amountMinor: minor(amount || numeric(row.TotalAmt) / links.length),
    currency: nullableText(record(row.CurrencyRef).value), occurredOn: isoDate(row.TxnDate), reference: nullableText(row.DocNumber),
  }));
}

function entityName(kind: AccountingEntityKind) {
  return { contact: "Customer", invoice: "Invoice", payment: "Payment", credit_note: "CreditMemo" }[kind];
}

export const quickBooksAdapter: AccountingAdapter = {
  provider: "quickbooks",
  requiredScopes: [ACCOUNTING_SCOPE],
  capabilities: {
    contacts: "read", invoices: "read", payments: "read", creditNotes: "read",
    incremental: "webhook_and_poll", writeBack: true,
  },
  getAuthorizationUrl({ state, redirectUri }) {
    const { clientId } = credentials();
    const url = new URL(AUTHORIZE_URL);
    url.search = new URLSearchParams({ client_id: clientId, response_type: "code", scope: ACCOUNTING_SCOPE, redirect_uri: redirectUri, state }).toString();
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
    await fetchJson(REVOKE_URL, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ token: refreshToken }),
    }, "QuickBooks token revocation");
  },
  async getOrganization(accessToken, hint) {
    const realmId = hint?.trim();
    if (!realmId) throw new Error("QuickBooks did not return a company realm ID.");
    const response = record(await fetchJson(`${apiBase()}/v3/company/${encodeURIComponent(realmId)}/companyinfo/${encodeURIComponent(realmId)}?minorversion=75`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    }, "QuickBooks company lookup"));
    const info = record(response.CompanyInfo);
    return {
      externalTenantId: realmId, name: text(info.CompanyName) || "QuickBooks company",
      countryCode: nullableText(info.Country), baseCurrency: nullableText(record(info.CurrencyRef).value),
    };
  },
  async fetchPage({ accessToken, externalTenantId, kind, cursor, modifiedSince }): Promise<AccountingPage> {
    const start = Math.max(1, Number(cursor) || 1);
    const entity = entityName(kind);
    const safeSince = modifiedSince && !Number.isNaN(new Date(modifiedSince).getTime())
      ? new Date(modifiedSince).toISOString().replaceAll("'", "") : null;
    const query = `SELECT * FROM ${entity}${safeSince ? ` WHERE Metadata.LastUpdatedTime > '${safeSince}'` : ""} STARTPOSITION ${start} MAXRESULTS 1000`;
    const url = new URL(`${apiBase()}/v3/company/${encodeURIComponent(externalTenantId)}/query`);
    url.searchParams.set("query", query);
    url.searchParams.set("minorversion", "75");
    const response = record(await fetchJson(url.toString(), { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } }, `QuickBooks ${kind} sync`));
    const queryResponse = record(response.QueryResponse);
    const source = records(queryResponse[entity]);
    const normalized = source.flatMap((item) => {
      if (kind === "contact") return qbContact(item) ?? [];
      if (kind === "invoice") return qbInvoice(item) ?? [];
      if (kind === "payment") return qbPayments(item);
      return qbCredits(item);
    });
    return { records: normalized, nextCursor: source.length >= 1000 ? String(start + 1000) : null };
  },
  async createPaymentAllocation(accessToken: string, externalTenantId: string, input: AccountingPaymentAllocationWriteback) {
    if (!input.externalCustomerId) throw new Error("QuickBooks payment write-back requires the mapped customer identifier.");
    const url = new URL(`${apiBase()}/v3/company/${encodeURIComponent(externalTenantId)}/payment`);
    url.searchParams.set("minorversion", "75");
    url.searchParams.set("requestid", input.idempotencyKey);
    const response = record(await fetchJson(url.toString(), {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ CustomerRef: { value: input.externalCustomerId }, TotalAmt: minorToMajorNumber(input.amountMinor, input.currency), TxnDate: input.occurredOn, PaymentRefNum: input.reference ?? input.idempotencyKey, DepositToAccountRef: { value: input.cashAccountId }, Line: [{ Amount: minorToMajorNumber(input.amountMinor, input.currency), LinkedTxn: [{ TxnId: input.externalInvoiceId, TxnType: "Invoice" }] }] }),
    }, "QuickBooks payment allocation write-back"));
    const externalRecordId = text(record(response.Payment).Id);
    if (!externalRecordId) throw new Error("QuickBooks payment write-back returned no payment identifier.");
    return { externalRecordId };
  },
};
