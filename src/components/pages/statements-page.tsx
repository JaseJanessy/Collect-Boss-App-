"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CalendarDays, CheckCircle2, Download, FileText, RefreshCw } from "lucide-react";
import { PrimaryButton } from "@/components/ui/primary-button";
import { LoadingSpinner, InlineSpinner } from "@/components/ui/loading-spinner";
import type { StatementData, StatementPayment, StatementPeriod } from "@/lib/statements/service";

const PERIODS: Array<{ value: StatementPeriod; label: string }> = [
  { value: "3m", label: "Last 3 months" },
  { value: "6m", label: "Last 6 months" },
  { value: "12m", label: "Last 1 year" },
];

function money(value: number): string {
  return new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(value);
}

function displayDate(value: string): string {
  return new Date(value).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function paymentMethod(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function StatementsPage() {
  const [period, setPeriod] = useState<StatementPeriod>("3m");
  const [statement, setStatement] = useState<StatementData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const query = useMemo(() => new URLSearchParams({ period }).toString(), [period]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      setSuccess(false);
      try {
        const response = await fetch(`/api/statements/summary?${query}`, { cache: "no-store" });
        const payload = await response.json() as StatementData & { error?: string };
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
      link.download = `collectboss-statement-${period}.pdf`;
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

  const isEmpty = statement?.summary.totalCases === 0 && statement.summary.paymentCount === 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 pb-8 md:px-0 md:py-1">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-black text-[#0D1B3D]">Statements</h1>
          <p className="mt-1 text-sm text-gray-500">View and download account payment statements.</p>
        </div>
        <div className="w-full sm:w-auto">
          <PrimaryButton fullWidth size="lg" onClick={download} disabled={loading || !!error || !statement || downloading} icon={downloading ? <InlineSpinner className="text-white" /> : <Download className="h-4 w-4" />}>
            {downloading ? "Generating PDF..." : "Download PDF"}
          </PrimaryButton>
        </div>
      </div>

      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm md:p-5">
        <div className="mb-3 flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-[#009966]" />
          <h2 className="text-sm font-bold text-gray-900">Statement period</h2>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {PERIODS.map((option) => (
            <button key={option.value} type="button" onClick={() => setPeriod(option.value)} className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors ${period === option.value ? "border-[#009966] bg-emerald-50 text-emerald-800" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
              {option.label}
            </button>
          ))}
        </div>
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
            <div className="mb-4 flex items-start justify-between gap-3"><div><p className="text-sm font-bold text-gray-900">{statement.businessName}</p><p className="mt-0.5 text-xs text-gray-500">Collection activity statement</p></div><FileText className="h-5 w-5 text-[#009966]" /></div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
              <Stat label="Total cases" value={String(statement.summary.totalCases)} />
              <Stat label="Total due" value={money(statement.summary.totalDue)} />
              <Stat label="Collected in period" value={money(statement.summary.totalPaid)} />
              <Stat label="Outstanding" value={money(statement.summary.totalOutstanding)} />
              <Stat label="Payments" value={String(statement.summary.paymentCount)} />
              <Stat label="Active plans" value={String(statement.summary.activePaymentPlans)} />
            </div>
          </>
        ) : null}
      </section>

      {statement && !loading && !error && !isEmpty && <Transactions payments={statement.payments} />}

      {success && <div className="mt-4 flex gap-2 rounded-xl border border-emerald-100 bg-emerald-50 p-3"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /><p className="text-sm text-emerald-800">Your statement PDF has been generated.</p></div>}

      <p className="mt-5 text-center text-[11px] leading-relaxed text-gray-400">Statements use live approved payment activity and the same current ledger balance projection as reports. They are not tax invoices or payment receipts.</p>
    </div>
  );
}

function Transactions({ payments }: { payments: StatementPayment[] }) {
  return (
    <section className="mt-4 rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="border-b border-gray-100 p-4 md:p-5"><h2 className="text-sm font-bold text-gray-900">Payment activity</h2><p className="mt-0.5 text-xs text-gray-500">Approved payments recorded in the selected period.</p></div>
      {payments.length === 0 ? <div className="p-6 text-center text-sm text-gray-500">No approved payments were recorded in this period.</div> : <>
        <div className="cb-phone-landscape-mobile-block divide-y divide-gray-100 md:hidden">
          {payments.map((payment) => <PaymentCard key={`${payment.caseReference}-${payment.referenceNo ?? payment.approvedAt}`} payment={payment} />)}
        </div>
        <div className="cb-phone-landscape-desktop hidden overflow-x-auto md:block">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-gray-50 text-[10px] font-bold uppercase tracking-wide text-gray-400"><tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Case reference</th><th className="px-4 py-3">Debtor / customer</th><th className="px-4 py-3">Payment reference</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Amount</th></tr></thead>
            <tbody className="divide-y divide-gray-100">{payments.map((payment) => <tr key={`${payment.caseReference}-${payment.referenceNo ?? payment.approvedAt}`}><td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600">{displayDate(payment.approvedAt)}</td><td className="px-4 py-3 font-mono text-xs font-semibold text-gray-800">{payment.caseReference}</td><td className="max-w-[180px] px-4 py-3"><p className="truncate font-semibold text-gray-900">{payment.customerName}</p>{payment.customerCompany && <p className="truncate text-xs text-gray-400">{payment.customerCompany}</p>}</td><td className="max-w-[140px] truncate px-4 py-3 text-xs text-gray-600">{payment.referenceNo ?? "-"}</td><td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600">{paymentMethod(payment.paymentMethod)}</td><td className="px-4 py-3"><span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">{payment.paymentStatus}</span></td><td className="whitespace-nowrap px-4 py-3 text-right font-bold text-emerald-700">{money(payment.amount)}</td></tr>)}</tbody>
          </table>
        </div>
      </>}
    </section>
  );
}

function PaymentCard({ payment }: { payment: StatementPayment }) {
  return <div className="p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold text-gray-900 break-words">{payment.customerName}</p>{payment.customerCompany && <p className="mt-0.5 text-xs text-gray-400 break-words">{payment.customerCompany}</p>}</div><p className="shrink-0 font-bold text-emerald-700">{money(payment.amount)}</p></div><div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs"><Detail label="Date" value={displayDate(payment.approvedAt)} /><Detail label="Case reference" value={payment.caseReference} /><Detail label="Payment reference" value={payment.referenceNo ?? "-"} /><Detail label="Type" value={paymentMethod(payment.paymentMethod)} /></div><span className="mt-3 inline-flex rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">{payment.paymentStatus}</span></div>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{label}</p><p className="mt-0.5 break-words text-gray-700">{value}</p></div>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-xl bg-gray-50 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{label}</p><p className="mt-1 break-words text-sm font-black text-gray-900">{value}</p></div>;
}
