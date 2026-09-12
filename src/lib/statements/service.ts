import "server-only";

import { isSupabaseConfigured } from "@/lib/supabase/client";
import { getServerClient } from "@/lib/supabase/server-client";
export { getOwnerStatementDataV2, Statement2AccessError, Statement2ValidationError } from "./builder";
export type { Statement2Data, Statement2Summary, Statement2Payment, StatementCustomerOption, StatementType, RecoveryActivity, RecoverySummary } from "./builder";
export type { StatementPeriod as StatementPeriodV2 } from "./periods";

export type StatementPeriod = "3m" | "6m" | "12m";

export interface StatementPayment {
  caseReference: string;
  customerName: string;
  customerCompany: string | null;
  invoiceNo: string | null;
  amount: number;
  paymentMethod: string;
  referenceNo: string | null;
  approvedAt: string;
  paymentStatus: "Approved";
}

export interface StatementSummary {
  totalCases: number;
  totalDue: number;
  totalPaid: number;
  totalOutstanding: number;
  paymentCount: number;
  activePaymentPlans: number;
}

export interface StatementData {
  businessName: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  summary: StatementSummary;
  payments: StatementPayment[];
}

export class StatementAccessError extends Error {}
export class StatementValidationError extends Error {}

interface DateRange {
  from: Date;
  to: Date;
  label: string;
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function subtractCalendarMonthsUtc(value: Date, months: number): Date {
  const monthIndex = value.getUTCMonth() - months;
  const year = value.getUTCFullYear() + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(value.getUTCDate(), lastDay)));
}

function formatDate(value: Date): string {
  return value.toLocaleDateString("en-MY", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function resolveStatementRange(period: string | null, now = new Date()): DateRange {
  const months = period === "3m" ? 3 : period === "6m" ? 6 : period === "12m" ? 12 : null;
  if (!months) throw new StatementValidationError("Choose a supported statement period.");

  const from = startOfUtcDay(subtractCalendarMonthsUtc(now, months));
  const to = new Date(now);
  return { from, to, label: `${formatDate(from)} - ${formatDate(to)}` };
}

/**
 * Builds an owner-scoped Collection Activity Statement. It has no mock
 * fallback: all results come from the authenticated owner's live records.
 */
export async function getOwnerStatementData(input: { period: string | null }): Promise<StatementData> {
  if (!isSupabaseConfigured) throw new StatementAccessError("Statements require a live database connection.");

  const client = await getServerClient();
  if (!client) throw new StatementAccessError("Unable to verify your session.");

  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) throw new StatementAccessError("Sign in to view statements.");

  const range = resolveStatementRange(input.period);
  const { data: business, error: businessError } = await client
    .from("businesses")
    .select("id, business_name")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (businessError) throw new StatementAccessError(businessError.message);
  if (!business) throw new StatementAccessError("Business profile not found.");

  // The explicit business filter complements RLS and prevents cross-business
  // data use even if a future policy is changed incorrectly.
  const { data: cases, error: casesError } = await client
    .from("cases")
    .select("id, debtor_name, debtor_company, invoice_no, contractual_due_minor, outstanding_minor, created_at")
    .eq("business_id", business.id);
  if (casesError) throw new StatementAccessError(casesError.message);

  const caseRows = cases ?? [];
  const caseIds = caseRows.map((item) => String(item.id));
  const emptySummary: StatementSummary = {
    totalCases: 0, totalDue: 0, totalPaid: 0, totalOutstanding: 0, paymentCount: 0, activePaymentPlans: 0,
  };
  if (caseIds.length === 0) {
    return {
      businessName: String(business.business_name), periodLabel: range.label,
      periodStart: range.from.toISOString(), periodEnd: range.to.toISOString(), generatedAt: new Date().toISOString(),
      summary: emptySummary, payments: [],
    };
  }

  const [{ data: payments, error: paymentsError }, { data: activePlans, error: plansError }] = await Promise.all([
    client.from("payments")
      .select("case_id, amount, payment_method, reference_no, reviewed_at")
      .in("case_id", caseIds)
      .eq("review_status", "approved")
      .gte("reviewed_at", range.from.toISOString())
      .lt("reviewed_at", range.to.toISOString())
      .order("reviewed_at", { ascending: false }),
    client.from("payment_plans")
      .select("case_id")
      .in("case_id", caseIds)
      .eq("status", "active"),
  ]);
  if (paymentsError) throw new StatementAccessError(paymentsError.message);
  if (plansError) throw new StatementAccessError(plansError.message);

  const casesById = new Map(caseRows.map((item) => [String(item.id), item]));
  const statementPayments: StatementPayment[] = (payments ?? []).flatMap((payment) => {
    const caseReference = String(payment.case_id);
    const caseRow = casesById.get(caseReference);
    if (!caseRow || !payment.reviewed_at) return [];
    return [{
      caseReference,
      customerName: String(caseRow.debtor_name),
      customerCompany: caseRow.debtor_company ? String(caseRow.debtor_company) : null,
      invoiceNo: caseRow.invoice_no ? String(caseRow.invoice_no) : null,
      amount: toNumber(payment.amount),
      paymentMethod: String(payment.payment_method),
      referenceNo: payment.reference_no ? String(payment.reference_no) : null,
      approvedAt: String(payment.reviewed_at),
      paymentStatus: "Approved",
    }];
  });

  return {
    businessName: String(business.business_name),
    periodLabel: range.label,
    periodStart: range.from.toISOString(),
    periodEnd: range.to.toISOString(),
    generatedAt: new Date().toISOString(),
    summary: {
      // Current balances use the same ledger-maintained minor-unit projection
      // used by dashboard and reports. Payment activity remains period-scoped.
      totalCases: caseRows.length,
      totalDue: caseRows.reduce((sum, caseRow) => sum + toNumber(caseRow.contractual_due_minor) / 100, 0),
      totalPaid: statementPayments.reduce((sum, payment) => sum + payment.amount, 0),
      totalOutstanding: caseRows.reduce((sum, caseRow) => sum + toNumber(caseRow.outstanding_minor) / 100, 0),
      paymentCount: statementPayments.length,
      activePaymentPlans: (activePlans ?? []).length,
    },
    payments: statementPayments,
  };
}
