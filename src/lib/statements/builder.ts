import "server-only";

import { isSupabaseConfigured } from "@/lib/supabase/client";
import { getServerClient } from "@/lib/supabase/server-client";
import { calculateStatementLedger, type StatementAccount, type StatementCaseInput, type StatementEventInput, type StatementTransaction } from "./calculations";
import { resolveStatementRange, StatementPeriodError, type StatementPeriod } from "./periods";
import { resolveRegionSettings } from "@/lib/international/registry";
import type { RegionSettings } from "@/lib/international/types";
import { formatAddress } from "@/lib/international/address";
import { businessRegistrationIdentifierSchema, structuredAddressSchema } from "@/lib/international/validation";
import { minorToMajorNumber, normalizeCurrencyCode } from "@/lib/financial/money";

export type StatementType = "account" | "recovery";

export interface StatementCustomerOption { id: string; name: string; company: string | null; accountCount: number }
export interface Statement2Payment { caseReference: string; customerName: string; customerCompany: string | null; invoiceNo: string | null; amount: number; paymentMethod: string; referenceNo: string | null; approvedAt: string; paymentStatus: "Approved" }
export interface RecoveryActivity { id: string; kind: "reminder" | "promise" | "payment_plan" | "status" | "dispute"; occurredAt: string; caseReference: string; invoiceNo: string | null; label: string; status: string }
export interface RecoverySummary { reminderCount: number; promiseCount: number; activePaymentPlans: number; disputeCount: number; lastContactAt: string | null; recoveryStatuses: Array<{ status: string; count: number }>; activities: RecoveryActivity[] }
export interface Statement2Summary {
  totalCases: number; totalDue: number; totalPaid: number; totalOutstanding: number; paymentCount: number; activePaymentPlans: number;
  openingBalance: number; periodDebits: number; periodPayments: number; periodCredits: number; periodReversals: number; movement: number; closingBalance: number;
  periodAdjustments?: number; periodWriteOffs?: number; periodSettlements?: number;
}
export interface Statement2Data {
  version: 2; statementType: StatementType; currency: string; availableCurrencies?: string[]; region?: RegionSettings;
  businessId?: string; caseReferences?: string[];
  businessName: string; businessRegistrationNo: string | null; businessAddress: string | null;
  customerId: string | null; customerName: string; customerCompany: string | null; customers: StatementCustomerOption[];
  period: StatementPeriod; periodLabel: string; periodStart: string; periodEnd: string; generatedAt: string;
  summary: Statement2Summary; payments: Statement2Payment[]; transactions: StatementTransaction[]; accounts: StatementAccount[]; recovery: RecoverySummary | null;
}

export class Statement2AccessError extends Error {}
export class Statement2ValidationError extends Error {}

const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const major = (minor: number, currency: string) => minorToMajorNumber(minor, currency);
const customerKey = (item: { debtor_id: unknown; debtor_name: unknown; debtor_company: unknown }) => item.debtor_id
  ? String(item.debtor_id)
  : `legacy:${String(item.debtor_name).trim().toLowerCase()}:${String(item.debtor_company ?? "").trim().toLowerCase()}`;
const within = (value: unknown, from: Date, to: Date) => {
  if (!value) return false;
  const timestamp = new Date(String(value)).getTime();
  return timestamp >= from.getTime() && timestamp < to.getTime();
};

export async function getOwnerStatementDataV2(input: { period: string | null; type?: string | null; customerId?: string | null; currency?: string | null; from?: string | null; to?: string | null }): Promise<Statement2Data> {
  if (!isSupabaseConfigured) throw new Statement2AccessError("Statements require a live database connection.");
  const client = await getServerClient();
  if (!client) throw new Statement2AccessError("Unable to verify your session.");
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) throw new Statement2AccessError("Sign in to view statements.");

  const type: StatementType = !input.type || input.type === "account" ? "account" : input.type === "recovery" ? "recovery" : (() => { throw new Statement2ValidationError("Choose account or recovery statement."); })();
  const period = (input.period ?? "3m") as StatementPeriod;

  const { data: business, error: businessError } = await client.from("businesses").select("id, business_name, registration_no, registration_identifiers, address, address_details, country_code, locale, timezone, default_currency, date_format, number_format, language_code").eq("owner_id", user.id).maybeSingle();
  if (businessError) throw new Statement2AccessError(businessError.message);
  if (!business) throw new Statement2AccessError("Business profile not found.");
  const region = resolveRegionSettings(business);
  const structuredAddress = structuredAddressSchema.safeParse(business.address_details);
  const identifiers = businessRegistrationIdentifierSchema.array().safeParse(business.registration_identifiers);
  const primaryIdentifier = identifiers.success ? identifiers.data[0]?.value ?? null : null;
  let range;
  try { range = resolveStatementRange(input.period, new Date(), input.from ?? null, input.to ?? null, region); }
  catch (error) { if (error instanceof StatementPeriodError) throw new Statement2ValidationError(error.message); throw error; }
  const { data: caseData, error: casesError } = await client.from("cases")
    .select("id, debtor_id, debtor_name, debtor_company, invoice_no, currency, original_principal_minor, contractual_due_minor, created_at, status, due_date, promise_due_date, archived_at")
    .eq("business_id", business.id);
  if (casesError) throw new Statement2AccessError(casesError.message);
  const allCases = caseData ?? [];

  const customerMap = new Map<string, StatementCustomerOption>();
  for (const item of allCases) {
    const id = customerKey(item); const existing = customerMap.get(id);
    if (existing) existing.accountCount += 1;
    else customerMap.set(id, { id, name: String(item.debtor_name), company: item.debtor_company ? String(item.debtor_company) : null, accountCount: 1 });
  }
  const customers = [...customerMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  const selectedCustomer = input.customerId ? customerMap.get(input.customerId) : null;
  if (input.customerId && !selectedCustomer) throw new Statement2ValidationError("Choose a customer from this business.");
  const customerCases = input.customerId ? allCases.filter((item) => customerKey(item) === input.customerId) : allCases;
  const availableCurrencies = [...new Set(customerCases.map((item) => normalizeCurrencyCode(String(item.currency ?? region.defaultCurrency))))].sort();
  const requestedCurrency = input.currency ? normalizeCurrencyCode(input.currency) : null;
  if (requestedCurrency && !availableCurrencies.includes(requestedCurrency)) throw new Statement2ValidationError("The selected customer has no records in that currency.");
  const currency = requestedCurrency ?? (availableCurrencies.includes(region.defaultCurrency) ? region.defaultCurrency : availableCurrencies[0] ?? region.defaultCurrency);
  const selectedCases = customerCases.filter((item) => normalizeCurrencyCode(String(item.currency ?? region.defaultCurrency)) === currency);
  const caseIds = selectedCases.map((item) => String(item.id));
  const casesById = new Map(selectedCases.map((item) => [String(item.id), item]));

  const empty = { data: [] as Array<Record<string, unknown>>, error: null };
  const [eventsResult, paymentsResult, plansResult, adjustmentsResult] = caseIds.length === 0 ? [empty, empty, empty, empty] : await Promise.all([
    client.from("case_financial_events").select("id, case_id, event_type, amount_minor, currency, source_table, source_id, created_at").in("case_id", caseIds).lt("created_at", range.toExclusive.toISOString()).order("created_at", { ascending: true }),
    client.from("payments").select("case_id, amount, amount_minor, currency, payment_method, reference_no, reviewed_at").in("case_id", caseIds).eq("review_status", "approved").gte("reviewed_at", range.from.toISOString()).lt("reviewed_at", range.toExclusive.toISOString()).order("reviewed_at", { ascending: false }),
    client.from("payment_plans").select("id, case_id, status, frequency, created_at, accepted_at, rejected_at, confirmed_at").in("case_id", caseIds),
    client.from("financial_adjustments").select("id, adjustment_type").in("case_id", caseIds).eq("approval_status", "approved"),
  ]);
  if (eventsResult.error) throw new Statement2AccessError(eventsResult.error.message);
  if (paymentsResult.error) throw new Statement2AccessError(paymentsResult.error.message);
  if (plansResult.error) throw new Statement2AccessError(plansResult.error.message);
  if (adjustmentsResult.error) throw new Statement2AccessError(adjustmentsResult.error.message);

  const statementCases: StatementCaseInput[] = selectedCases.map((item) => ({ id: String(item.id), debtorId: item.debtor_id ? String(item.debtor_id) : null, customerName: String(item.debtor_name), customerCompany: item.debtor_company ? String(item.debtor_company) : null, invoiceNo: item.invoice_no ? String(item.invoice_no) : null, originalPrincipalMinor: String(item.original_principal_minor), createdAt: String(item.created_at), status: String(item.status), dueDate: String(item.due_date) }));
  const adjustmentTypes = new Map((adjustmentsResult.data ?? []).map((item) =>
    [String(item.id), item.adjustment_type as NonNullable<StatementEventInput["adjustmentType"]>]));
  const statementEvents: StatementEventInput[] = (eventsResult.data ?? []).map((item) => ({
    id: String(item.id), caseId: String(item.case_id), type: item.event_type as StatementEventInput["type"],
    amountMinor: String(item.amount_minor), createdAt: String(item.created_at),
    adjustmentType: item.source_table === "financial_adjustments"
      ? adjustmentTypes.get(String(item.source_id)) ?? null : null,
  }));
  if ((eventsResult.data ?? []).some((item) => normalizeCurrencyCode(String(item.currency ?? currency)) !== currency)) throw new Statement2ValidationError("A ledger event currency does not match its statement currency.");
  const ledger = calculateStatementLedger(statementCases, statementEvents, range);
  const payments: Statement2Payment[] = (paymentsResult.data ?? []).flatMap((payment) => {
    const item = casesById.get(String(payment.case_id)); if (!item || !payment.reviewed_at) return [];
    if (normalizeCurrencyCode(String(payment.currency ?? currency)) !== currency) throw new Statement2ValidationError("A payment currency does not match its statement currency.");
    return [{ caseReference: String(payment.case_id), customerName: String(item.debtor_name), customerCompany: item.debtor_company ? String(item.debtor_company) : null, invoiceNo: item.invoice_no ? String(item.invoice_no) : null, amount: major(number(payment.amount_minor), currency), paymentMethod: String(payment.payment_method), referenceNo: payment.reference_no ? String(payment.reference_no) : null, approvedAt: String(payment.reviewed_at), paymentStatus: "Approved" as const }];
  });
  const activePlans = (plansResult.data ?? []).filter((plan) => plan.status === "active").length;

  let recovery: RecoverySummary | null = null;
  if (type === "recovery" && caseIds.length > 0) {
    const [remindersResult, statusesResult] = await Promise.all([
      client.from("reminders").select("id, case_id, message_type, sent_channel, status, sent_at, generated_at, manually_confirmed_at").in("case_id", caseIds).order("generated_at", { ascending: true }),
      client.from("case_status_history").select("id, case_id, from_status, to_status, created_at").in("case_id", caseIds).order("created_at", { ascending: true }),
    ]);
    if (remindersResult.error) throw new Statement2AccessError(remindersResult.error.message);
    if (statusesResult.error) throw new Statement2AccessError(statusesResult.error.message);
    const activities: RecoveryActivity[] = []; let lastContactAt: string | null = null;
    for (const reminder of remindersResult.data ?? []) {
      const contactedAt = String(reminder.manually_confirmed_at ?? reminder.sent_at ?? reminder.generated_at);
      if ((reminder.manually_confirmed_at || reminder.status === "sent" || reminder.status === "sent_manually") && new Date(contactedAt) < range.toExclusive && (!lastContactAt || contactedAt > lastContactAt)) lastContactAt = contactedAt;
      if (!within(reminder.generated_at, range.from, range.toExclusive)) continue;
      const item = casesById.get(String(reminder.case_id)); if (!item) continue;
      activities.push({ id: String(reminder.id), kind: "reminder", occurredAt: String(reminder.generated_at), caseReference: String(reminder.case_id), invoiceNo: item.invoice_no ? String(item.invoice_no) : null, label: `${String(reminder.message_type).replaceAll("_", " ")} reminder`, status: String(reminder.status) });
    }
    for (const history of statusesResult.data ?? []) {
      if (!within(history.created_at, range.from, range.toExclusive)) continue;
      const item = casesById.get(String(history.case_id)); if (!item) continue;
      activities.push({ id: String(history.id), kind: history.to_status === "payment_promise" ? "promise" : "status", occurredAt: String(history.created_at), caseReference: String(history.case_id), invoiceNo: item.invoice_no ? String(item.invoice_no) : null, label: history.to_status === "payment_promise" ? "Promise to Pay recorded" : "Recovery status changed", status: String(history.to_status) });
    }
    for (const plan of plansResult.data ?? []) for (const milestone of [
      { at: plan.created_at, label: "Payment plan proposed", status: "proposed" },
      { at: plan.accepted_at ?? plan.confirmed_at, label: "Payment plan accepted", status: "accepted" },
      { at: plan.rejected_at, label: "Payment plan rejected", status: "rejected" },
    ]) {
      if (!within(milestone.at, range.from, range.toExclusive)) continue;
      const item = casesById.get(String(plan.case_id)); if (!item) continue;
      activities.push({ id: `${String(plan.id)}:${milestone.status}`, kind: "payment_plan", occurredAt: String(milestone.at), caseReference: String(plan.case_id), invoiceNo: item.invoice_no ? String(item.invoice_no) : null, label: milestone.label, status: milestone.status });
    }
    activities.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
    const statuses = new Map<string, number>(); for (const item of selectedCases) statuses.set(String(item.status), (statuses.get(String(item.status)) ?? 0) + 1);
    recovery = { reminderCount: activities.filter((item) => item.kind === "reminder").length, promiseCount: activities.filter((item) => item.kind === "promise").length, activePaymentPlans: activePlans, disputeCount: 0, lastContactAt, recoveryStatuses: [...statuses].map(([status, count]) => ({ status, count })), activities };
  }

  const contractualAtClose = selectedCases.reduce((sum, item) => {
    if (new Date(String(item.created_at)) >= range.toExclusive) return sum;
    return sum + number(item.original_principal_minor) + statementEvents.filter((event) => event.caseId === String(item.id)).reduce((eventSum, event) => eventSum + (event.type === "adjustment_debit" ? number(event.amountMinor) : event.type === "adjustment_credit" ? -number(event.amountMinor) : 0), 0);
  }, 0);
  return {
    version: 2, statementType: type, currency, availableCurrencies, region, businessId: String(business.id), caseReferences: caseIds,
    businessName: String(business.business_name), businessRegistrationNo: primaryIdentifier ?? (business.registration_no ? String(business.registration_no) : null), businessAddress: structuredAddress.success ? formatAddress(structuredAddress.data) : business.address ? String(business.address) : null,
    customerId: input.customerId ?? null, customerName: selectedCustomer?.name ?? "All customers", customerCompany: selectedCustomer?.company ?? null, customers,
    period, periodLabel: range.label, periodStart: range.from.toISOString(), periodEnd: range.toExclusive.toISOString(), generatedAt: new Date().toISOString(),
    summary: { totalCases: ledger.accounts.length, totalDue: major(contractualAtClose, currency), totalPaid: payments.reduce((sum, payment) => sum + payment.amount, 0), totalOutstanding: major(ledger.totalOutstandingMinor, currency), paymentCount: payments.length, activePaymentPlans: activePlans, openingBalance: major(ledger.openingBalanceMinor, currency), periodDebits: major(ledger.periodDebitsMinor, currency), periodPayments: major(ledger.periodPaymentsMinor, currency), periodCredits: major(ledger.periodCreditsMinor, currency), periodAdjustments: major(ledger.periodAdjustmentsMinor, currency), periodWriteOffs: major(ledger.periodWriteOffsMinor, currency), periodSettlements: major(ledger.periodSettlementsMinor, currency), periodReversals: major(ledger.periodReversalsMinor, currency), movement: major(ledger.movementMinor, currency), closingBalance: major(ledger.closingBalanceMinor, currency) },
    payments, transactions: ledger.transactions, accounts: ledger.accounts, recovery,
  };
}
