"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CalendarDays, CheckCircle2, Download, FileText, RefreshCw } from "lucide-react";
import { PrimaryButton } from "@/components/ui/primary-button";
import { LoadingSpinner, InlineSpinner } from "@/components/ui/loading-spinner";
import type { Statement2Data, StatementPeriodV2, StatementType } from "@/lib/statements/service";
import type { StatementTransaction } from "@/lib/statements/calculations";
import { useRegion } from "@/contexts/region-context";
import { formatCurrency, formatDate, formatMinorCurrency } from "@/lib/international/formatting";

const PERIODS: Array<{ value: StatementPeriodV2; label: string }> = [
  { value: "current_month", label: "Current Month" },
  { value: "3m", label: "3 Months" },
  { value: "6m", label: "6 Months" },
  { value: "12m", label: "12 Months" },
  { value: "this_year", label: "This Year" },
  { value: "last_year", label: "Last Year" },
  { value: "custom", label: "Custom" },
];

function useStatementFormatters(currency?: string) {
  const { configuration } = useRegion();
  return {
    money: (value: number) => formatCurrency(value, configuration.settings, currency ?? configuration.settings.defaultCurrency),
    moneyMinor: (value: number) => formatMinorCurrency(value, configuration.settings, currency ?? configuration.settings.defaultCurrency),
    displayDate: (value: string) => formatDate(value, configuration.settings),
  };
}

function label(value: string): string { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }

export function StatementsPage() {
  const [period, setPeriod] = useState<StatementPeriodV2>("3m");
  const [statementType, setStatementType] = useState<StatementType>("account");
  const [customerId, setCustomerId] = useState("");
  const [currency, setCurrency] = useState("");
  const [customFrom, setCustomFrom] = useState(() => `${new Date().getUTCFullYear()}-01-01`);
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [statement, setStatement] = useState<Statement2Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const { money } = useStatementFormatters(statement?.currency);

  const query = useMemo(() => {
    const params = new URLSearchParams({ period, type: statementType });
    if (customerId) params.set("customer", customerId);
    if (currency) params.set("currency", currency);
    if (period === "custom") { params.set("from", customFrom); params.set("to", customTo); }
    return params.toString();
  }, [currency, customerId, customFrom, customTo, period, statementType]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      setSuccess(false);
      try {
        const response = await fetch(`/api/statements/summary?${query}`, { cache: "no-store" });
        const payload = await response.json() as Statement2Data & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Unable to load the statement preview.");
        if (!cancelled) setStatement(payload);
      } catch (reason) {
        if (!cancelled) {
          setStatement(null);
          setError(reason instanceof Error ? reason.message : "Unable to load the statement preview.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [query, reloadKey]);

  async function download() {
    if (downloading || !statement) return;
    setDownloading(true);
    setError(null);
    setSuccess(false);
    try {
      const response = await fetch(`/api/statements/pdf?${query}`, { cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        throw new Error(payload.error ?? "Unable to generate the statement.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `collectboss-${statementType}-statement-${period}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setSuccess(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to download the statement.");
    } finally {
      setDownloading(false);
    }
  }

  const isEmpty = statement?.summary.totalCases === 0 && statement.transactions.length === 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 pb-8 md:px-0 md:py-1">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-black text-[#0D1B3D]">Statements</h1>
          <p className="mt-1 text-sm text-gray-500">Reconciled account and recovery statements across customers, invoices and periods.</p>
        </div>
        <div className="w-full sm:w-auto">
          <PrimaryButton fullWidth size="lg" onClick={download} disabled={loading || !!error || !statement || downloading} icon={downloading ? <InlineSpinner className="text-white" /> : <Download className="h-4 w-4" />}>
            {downloading ? "Generating PDF..." : "Download PDF"}
          </PrimaryButton>
        </div>
      </div>

      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm md:p-5">
        <div className="mb-4 grid grid-cols-2 gap-2">
          {(["account", "recovery"] as const).map((type) => <button key={type} type="button" onClick={() => setStatementType(type)} className={`rounded-xl border px-3 py-2.5 text-sm font-bold ${statementType === type ? "border-[#009966] bg-emerald-50 text-emerald-800" : "border-gray-200 text-gray-600"}`}>{type === "account" ? "Account Statement" : "Recovery Statement"}</button>)}
        </div>
        <label className="mb-4 block text-xs font-bold text-gray-600">Customer
          <select value={customerId} onChange={(event) => { setCustomerId(event.target.value); setCurrency(""); }} className="mt-1 block w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-normal text-gray-800">
            <option value="">All customers</option>
            {statement?.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.company ? ` — ${customer.company}` : ""} ({customer.accountCount} {customer.accountCount === 1 ? "account" : "accounts"})</option>)}
          </select>
        </label>
        {statement && (statement.availableCurrencies?.length ?? 0) > 1 && <label className="mb-4 block text-xs font-bold text-gray-600">Statement currency<select value={currency || statement.currency} onChange={(event) => setCurrency(event.target.value)} className="mt-1 block w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-normal text-gray-800">{statement.availableCurrencies?.map((code) => <option key={code} value={code}>{code}</option>)}</select><span className="mt-1 block font-normal text-gray-400">Each statement reconciles one currency. No FX conversion is applied.</span></label>}
        <div className="mb-3 flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-[#009966]" />
          <h2 className="text-sm font-bold text-gray-900">Statement period</h2>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
          {PERIODS.map((option) => (
            <button key={option.value} type="button" onClick={() => setPeriod(option.value)} className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors ${period === option.value ? "border-[#009966] bg-emerald-50 text-emerald-800" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
              {option.label}
            </button>
          ))}
        </div>
        {period === "custom" && <div className="mt-3 grid grid-cols-2 gap-3"><label className="text-xs font-bold text-gray-600">From<input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className="mt-1 block w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-normal" /></label><label className="text-xs font-bold text-gray-600">To<input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className="mt-1 block w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-normal" /></label></div>}
        {statement && !loading && (
          <p className="mt-4 text-sm font-semibold text-gray-700">{statement.periodLabel}</p>
        )}
      </section>

      <section className="mt-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm md:p-5">
        {loading ? <LoadingSpinner /> : error ? (
          <div className="rounded-xl border border-red-100 bg-red-50 p-4">
            <div className="flex gap-3"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" /><p className="text-sm text-red-700">{error}</p></div>
            <button type="button" onClick={() => setReloadKey((value) => value + 1)} className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold text-red-700 underline underline-offset-2"><RefreshCw className="h-3.5 w-3.5" />Retry</button>
          </div>
        ) : statement && isEmpty ? (
          <div className="py-8 text-center"><FileText className="mx-auto h-7 w-7 text-gray-300" /><p className="mt-2 text-sm font-semibold text-gray-700">No statement activity was found for the selected period.</p><p className="mt-1 text-xs text-gray-500">You can still download an empty statement for your records.</p></div>
        ) : statement ? (
          <>
            <div className="mb-4 flex items-start justify-between gap-3"><div><p className="text-sm font-bold text-gray-900">{statement.businessName}</p><p className="mt-0.5 text-xs text-gray-500">{statement.customerName} · {statement.statementType === "recovery" ? "Recovery Statement" : "Account Statement"} · {statement.currency}</p></div><FileText className="h-5 w-5 text-[#009966]" /></div>
            <div className="mb-3 rounded-2xl bg-[#0D1B3D] p-4 text-white"><p className="text-[10px] font-bold uppercase tracking-wide text-blue-200">Closing balance</p><p className="mt-1 text-3xl font-black">{money(statement.summary.closingBalance)}</p><p className="mt-1 text-xs text-blue-200">Total outstanding {money(statement.summary.totalOutstanding)}</p></div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Stat label="Opening balance" value={money(statement.summary.openingBalance)} />
              <Stat label="Obligations / debits" value={money(statement.summary.periodDebits)} />
              <Stat label="Payments" value={money(statement.summary.periodPayments)} />
              <Stat label="Credits / credit notes" value={money(statement.summary.periodCredits)} />
              <Stat label="Other adjustments" value={money(statement.summary.periodAdjustments ?? 0)} />
              <Stat label="Write-offs" value={money(statement.summary.periodWriteOffs ?? 0)} />
              <Stat label="Settlement adjustments" value={money(statement.summary.periodSettlements ?? 0)} />
              <Stat label="Reversals" value={money(statement.summary.periodReversals)} />
              <Stat label="Net movement" value={money(statement.summary.movement)} />
              <Stat label="Accounts / invoices" value={String(statement.summary.totalCases)} />
              <Stat label="Active plans" value={String(statement.summary.activePaymentPlans)} />
            </div>
          </>
        ) : null}
      </section>

      {statement && !loading && !error && !isEmpty && <Transactions transactions={statement.transactions} currency={statement.currency} />}
      {statement?.recovery && !loading && !error && <RecoveryPanel statement={statement} />}

      {success && <div className="mt-4 flex gap-2 rounded-xl border border-emerald-100 bg-emerald-50 p-3"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /><p className="text-sm text-emerald-800">Your statement PDF has been generated.</p></div>}

      <p className="mt-5 text-center text-[11px] leading-relaxed text-gray-400">Opening balance + period movement = closing balance. Data comes from the existing financial ledger; internal notes and message contents are excluded. Statements are not tax invoices or payment receipts.</p>
    </div>
  );
}

function Transactions({ transactions, currency }: { transactions: StatementTransaction[]; currency: string }) {
  const { displayDate, moneyMinor } = useStatementFormatters(currency);
  return (
    <section className="mt-4 rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="border-b border-gray-100 p-4 md:p-5"><h2 className="text-sm font-bold text-gray-900">Transaction history</h2><p className="mt-0.5 text-xs text-gray-500">Obligations, payments, reversals and adjustments in the selected period.</p></div>
      {transactions.length === 0 ? <div className="p-6 text-center text-sm text-gray-500">No statement movements were recorded in this period.</div> : <>
        <div className="cb-phone-landscape-mobile-block divide-y divide-gray-100 md:hidden">
          {transactions.map((transaction) => <TransactionCard key={transaction.id} transaction={transaction} currency={currency} />)}
        </div>
        <div className="cb-phone-landscape-desktop hidden overflow-x-auto md:block">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-gray-50 text-[10px] font-bold uppercase tracking-wide text-gray-400"><tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Account / invoice</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Type</th><th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3 text-right">Balance effect</th></tr></thead>
            <tbody className="divide-y divide-gray-100">{transactions.map((transaction) => <tr key={transaction.id}><td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600">{displayDate(transaction.occurredAt)}</td><td className="px-4 py-3 font-mono text-xs font-semibold text-gray-800">{transaction.caseReference}{transaction.invoiceNo && <span className="block font-sans font-normal text-gray-400">{transaction.invoiceNo}</span>}</td><td className="max-w-[180px] px-4 py-3"><p className="truncate font-semibold text-gray-900">{transaction.customerName}</p>{transaction.customerCompany && <p className="truncate text-xs text-gray-400">{transaction.customerCompany}</p>}</td><td className="px-4 py-3"><span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-bold text-gray-700">{transaction.label}</span></td><td className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold text-gray-700">{moneyMinor(transaction.amountMinor)}</td><td className={`whitespace-nowrap px-4 py-3 text-right font-bold ${transaction.balanceEffectMinor <= 0 ? "text-emerald-700" : "text-red-700"}`}>{transaction.balanceEffectMinor > 0 ? "+" : "−"}{moneyMinor(Math.abs(transaction.balanceEffectMinor))}</td></tr>)}</tbody>
          </table>
        </div>
      </>}
    </section>
  );
}

function TransactionCard({ transaction, currency }: { transaction: StatementTransaction; currency: string }) {
  const { displayDate, moneyMinor } = useStatementFormatters(currency);
  return <div className="p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-words font-semibold text-gray-900">{transaction.label}</p><p className="mt-0.5 text-xs text-gray-400">{transaction.customerName}</p></div><p className={`shrink-0 font-bold ${transaction.balanceEffectMinor <= 0 ? "text-emerald-700" : "text-red-700"}`}>{transaction.balanceEffectMinor > 0 ? "+" : "−"}{moneyMinor(Math.abs(transaction.balanceEffectMinor))}</p></div><div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs"><Detail label="Date" value={displayDate(transaction.occurredAt)} /><Detail label="Account" value={transaction.caseReference} /><Detail label="Invoice" value={transaction.invoiceNo ?? "—"} /><Detail label="Category" value={label(transaction.category)} /></div></div>;
}

function RecoveryPanel({ statement }: { statement: Statement2Data }) {
  const recovery = statement.recovery!;
  const { displayDate } = useStatementFormatters(statement.currency);
  return <section className="mt-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm md:p-5"><h2 className="text-sm font-bold text-gray-900">Recovery activity</h2><div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5"><Stat label="Reminders" value={String(recovery.reminderCount)} /><Stat label="Promises" value={String(recovery.promiseCount)} /><Stat label="Active plans" value={String(recovery.activePaymentPlans)} /><Stat label="Disputes" value={String(recovery.disputeCount)} /><Stat label="Last contact" value={recovery.lastContactAt ? displayDate(recovery.lastContactAt) : "None recorded"} /></div><div className="mt-4 divide-y divide-gray-100">{recovery.activities.length === 0 ? <p className="py-4 text-sm text-gray-500">No recovery activity was recorded in this period.</p> : recovery.activities.map((activity) => <div key={activity.id} className="flex items-start justify-between gap-3 py-3"><div><p className="text-sm font-semibold text-gray-800">{label(activity.label)}</p><p className="mt-0.5 text-xs text-gray-400">{activity.caseReference}{activity.invoiceNo ? ` · ${activity.invoiceNo}` : ""}</p></div><div className="text-right"><p className="text-xs text-gray-500">{displayDate(activity.occurredAt)}</p><span className="mt-1 inline-block rounded-full bg-gray-100 px-2 py-1 text-[10px] font-bold text-gray-700">{label(activity.status)}</span></div></div>)}</div></section>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{label}</p><p className="mt-0.5 break-words text-gray-700">{value}</p></div>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-xl bg-gray-50 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{label}</p><p className="mt-1 break-words text-sm font-black text-gray-900">{value}</p></div>;
}
