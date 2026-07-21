import { requireSupabase } from '@/lib/supabase';

type Numeric = number | string | null | undefined;

export type Business = {
  id: string;
  owner_id: string;
  business_name: string;
  email: string | null;
  phone: string | null;
};

export type CollectionCase = {
  id: string;
  business_id: string;
  debtor_name: string;
  debtor_company: string | null;
  amount_owed: Numeric;
  amount_paid: Numeric;
  balance: Numeric;
  due_date: string;
  invoice_no: string | null;
  status: string;
  next_best_action: string | null;
  days_overdue: number;
  created_at: string;
};

export type Payment = {
  id: string;
  case_id: string;
  amount: Numeric;
  payment_method: string;
  reference_no: string | null;
  review_status: string;
  reviewed_at: string | null;
  created_at: string;
};

export type PaymentPlan = {
  id: string;
  case_id: string;
  total_amount: Numeric;
  installment_count: number;
  installment_amount: Numeric;
  start_date: string;
  status: string;
  debtor_confirmed: boolean;
  created_at: string;
};

export type OwnerData = {
  business: Business | null;
  cases: CollectionCase[];
  payments: Payment[];
  plans: PaymentPlan[];
};

export type StatementPeriod = '3m' | '6m' | '12m';

export const statementPeriodLabels: Record<StatementPeriod, string> = {
  '3m': 'Last 3 Months',
  '6m': 'Last 6 Months',
  '12m': 'Last 1 Year',
};

export function cents(value: Numeric): number {
  if (typeof value === 'number') return Math.round(value * 100);
  const input = String(value ?? '0').trim();
  const sign = input.startsWith('-') ? -1 : 1;
  const [whole = '0', decimal = ''] = input.replace(/^[+-]/, '').split('.');
  const major = Number.parseInt(whole.replace(/\D/g, '') || '0', 10);
  const minor = Number.parseInt((decimal.replace(/\D/g, '') + '00').slice(0, 2), 10);
  return sign * (major * 100 + minor);
}

export function money(value: Numeric): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'MYR' }).format(cents(value) / 100);
}

export function shortDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

export function statementDates(period: StatementPeriod, now = new Date()) {
  const months = period === '3m' ? 3 : period === '6m' ? 6 : 12;
  const end = new Date(now);
  const start = new Date(now);
  start.setMonth(start.getMonth() - months);
  return { start, end };
}

export function isInStatementPeriod(value: string, period: StatementPeriod): boolean {
  const { start, end } = statementDates(period);
  const date = new Date(value);
  return date >= start && date <= end;
}

export async function loadOwnerData(ownerId: string): Promise<OwnerData> {
  const client = requireSupabase();
  const businessResult = await client
    .from('businesses')
    .select('id, owner_id, business_name, email, phone')
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (businessResult.error) throw businessResult.error;
  const business = businessResult.data as Business | null;
  if (!business) return { business: null, cases: [], payments: [], plans: [] };

  const casesResult = await client
    .from('cases')
    .select('id, business_id, debtor_name, debtor_company, amount_owed, amount_paid, balance, due_date, invoice_no, status, next_best_action, days_overdue, created_at')
    .eq('business_id', business.id)
    .order('created_at', { ascending: false });
  if (casesResult.error) throw casesResult.error;
  const cases = (casesResult.data ?? []) as CollectionCase[];
  const caseIds = cases.map((item) => item.id);
  if (!caseIds.length) return { business, cases, payments: [], plans: [] };

  const [paymentsResult, plansResult] = await Promise.all([
    client
      .from('payments')
      .select('id, case_id, amount, payment_method, reference_no, review_status, reviewed_at, created_at')
      .in('case_id', caseIds)
      .order('created_at', { ascending: false }),
    client
      .from('payment_plans')
      .select('id, case_id, total_amount, installment_count, installment_amount, start_date, status, debtor_confirmed, created_at')
      .in('case_id', caseIds)
      .order('created_at', { ascending: false }),
  ]);
  if (paymentsResult.error) throw paymentsResult.error;
  if (plansResult.error) throw plansResult.error;
  return {
    business,
    cases,
    payments: (paymentsResult.data ?? []) as Payment[],
    plans: (plansResult.data ?? []) as PaymentPlan[],
  };
}
