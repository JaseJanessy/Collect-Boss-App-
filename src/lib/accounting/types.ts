export const accountingProviders = ["xero", "quickbooks"] as const;
export type AccountingProvider = typeof accountingProviders[number];

export const accountingEntityKinds = ["contact", "invoice", "payment", "credit_note"] as const;
export type AccountingEntityKind = typeof accountingEntityKinds[number];

export interface AccountingCapabilities {
  contacts: "read";
  invoices: "read";
  payments: "read";
  creditNotes: "read";
  incremental: "webhook_and_poll" | "poll";
  writeBack: boolean;
}

export interface AccountingPaymentAllocationWriteback {
  externalInvoiceId: string;
  externalCustomerId: string | null;
  cashAccountId: string;
  amountMinor: number;
  currency: string;
  occurredOn: string;
  reference: string | null;
  idempotencyKey: string;
}

export interface AccountingTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scopes: string[];
}

export interface AccountingOrganization {
  externalTenantId: string;
  name: string;
  countryCode: string | null;
  baseCurrency: string | null;
}

export interface NormalizedContact {
  kind: "contact";
  externalId: string;
  version: string | null;
  updatedAt: string | null;
  status: "active" | "archived";
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  registrationNumber: string | null;
  accountNumber: string | null;
  currency: string | null;
}

export interface NormalizedInvoice {
  kind: "invoice";
  externalId: string;
  contactExternalId: string;
  version: string | null;
  updatedAt: string | null;
  status: "draft" | "open" | "paid" | "void";
  reference: string;
  purchaseOrderReference: string | null;
  issueDate: string | null;
  dueDate: string;
  currency: string;
  totalMinor: number;
  paidMinor: number;
  creditedMinor: number;
  outstandingMinor: number;
}

export interface NormalizedPayment {
  kind: "payment";
  externalId: string;
  invoiceExternalId: string | null;
  version: string | null;
  updatedAt: string | null;
  status: "active" | "reversed";
  amountMinor: number;
  currency: string | null;
  occurredOn: string | null;
  reference: string | null;
}

export interface NormalizedCreditNote {
  kind: "credit_note";
  externalId: string;
  invoiceExternalId: string | null;
  version: string | null;
  updatedAt: string | null;
  status: "active" | "void";
  amountMinor: number;
  currency: string | null;
  occurredOn: string | null;
  reference: string | null;
}

export type NormalizedAccountingRecord =
  | NormalizedContact
  | NormalizedInvoice
  | NormalizedPayment
  | NormalizedCreditNote;

export interface AccountingPage {
  records: NormalizedAccountingRecord[];
  nextCursor: string | null;
}

export interface AccountingAdapter {
  readonly provider: AccountingProvider;
  readonly capabilities: AccountingCapabilities;
  readonly requiredScopes: readonly string[];
  getAuthorizationUrl(input: { state: string; redirectUri: string }): string;
  exchangeAuthorizationCode(input: { code: string; redirectUri: string }): Promise<AccountingTokens>;
  refreshTokens(refreshToken: string): Promise<AccountingTokens>;
  revoke(refreshToken: string): Promise<void>;
  getOrganization(accessToken: string, externalTenantIdHint?: string | null): Promise<AccountingOrganization>;
  fetchPage(input: {
    accessToken: string;
    externalTenantId: string;
    kind: AccountingEntityKind;
    cursor: string | null;
    modifiedSince: string | null;
  }): Promise<AccountingPage>;
  createPaymentAllocation?(accessToken: string, externalTenantId: string, input: AccountingPaymentAllocationWriteback): Promise<{ externalRecordId: string }>;
}

export interface AccountingConnectionRecord {
  id: string;
  business_id: string;
  created_by: string;
  provider: AccountingProvider;
  status: "pending" | "connected" | "error" | "disconnected" | "revoked";
  external_tenant_id: string | null;
  organization_name: string | null;
  scopes: string[];
  access_token_ciphertext: string | null;
  refresh_token_ciphertext: string | null;
  token_expires_at: string | null;
  last_successful_sync_at: string | null;
  last_attempted_sync_at: string | null;
  last_cursor: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  disconnected_at: string | null;
  metadata: Record<string, unknown>;
}

export interface PublicAccountingConnection {
  id: string;
  provider: AccountingProvider;
  status: AccountingConnectionRecord["status"];
  organizationName: string | null;
  scopes: string[];
  lastSuccessfulSyncAt: string | null;
  lastAttemptedSyncAt: string | null;
  lastError: string | null;
}
