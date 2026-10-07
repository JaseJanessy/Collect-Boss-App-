"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, FilePlus2, Layers3, Pencil, Plus, ReceiptText, X } from "lucide-react";
import type {
  AccountReceivableTotalsRow, CustomerAccountMode, CustomerAccountRow,
  CustomerAccountType, DebtorRow, ObligationRow, ReceivableTotalsRow,
} from "@/lib/supabase/types";
import { useRegion } from "@/contexts/region-context";
import { formatCalendarDate, formatMinorCurrency } from "@/lib/international/formatting";
import { RecurringChargesPanel } from "@/components/debtors/recurring-charges-panel";
import { CustomerTaxDetailsPanel } from "@/components/debtors/customer-tax-details-panel";
import { EinvoiceActions, useEinvoiceStatuses } from "@/components/debtors/einvoice-actions";

interface ReceivablesPayload {
  customer: DebtorRow;
  accounts: CustomerAccountRow[];
  accountTotals: AccountReceivableTotalsRow[];
  obligations: ObligationRow[];
  totals: ReceivableTotalsRow;
  totalsByCurrency: ReceivableTotalsRow[];
  creditLimitEnforcementEnabled: boolean;
  error?: string;
}

type AccountForm = {
  display_name: string;
  account_number: string;
  account_type: CustomerAccountType;
  account_mode: CustomerAccountMode;
  credit_limit: string;
  credit_warning_threshold_percent: number;
};

type InvoiceForm = {
  account_id: string;
  reference: string;
  purchase_order_reference: string;
  issue_date: string;
  due_date: string;
  original_amount: string;
};

const emptyAccount: AccountForm = {
  display_name: "",
  account_number: "",
  account_type: "general",
  account_mode: "one_off",
  credit_limit: "",
  credit_warning_threshold_percent: 80,
};
const emptyInvoice: InvoiceForm = {
  account_id: "",
  reference: "",
  purchase_order_reference: "",
  issue_date: "",
  due_date: "",
  original_amount: "",
};

const customerName = (customer: DebtorRow) =>
  customer.debtor_type === "business" ? customer.business_name : customer.individual_name;
const titleCase = (value: string) =>
  value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const creditWarningLabel = (warning: AccountReceivableTotalsRow["credit_warning"]) => ({
  no_limit: "No credit limit",
  within_limit: "Within credit limit",
  approaching_limit: "Approaching Credit Limit",
  limit_reached: "Credit Limit Reached",
  over_limit: "Credit Limit Exceeded",
})[warning];

export function CustomerReceivablesOverview({
  customer,
  onClose,
}: {
  customer: DebtorRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const { configuration } = useRegion();
  const formatMinor = (value: number, currency = configuration.settings.defaultCurrency) =>
    formatMinorCurrency(value, configuration.settings, currency);
  const [payload, setPayload] = useState<ReceivablesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [chasing, setChasing] = useState("");
  const [error, setError] = useState("");
  const [formMode, setFormMode] = useState<"account" | "invoice" | null>(null);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [accountForm, setAccountForm] = useState<AccountForm>(emptyAccount);
  const [invoiceForm, setInvoiceForm] = useState<InvoiceForm>(emptyInvoice);

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch(`/api/debtors/${customer.id}/receivables`, { cache: "no-store" });
    const result = await response.json().catch(() => ({})) as ReceivablesPayload;
    if (!response.ok) {
      setError(result.error ?? "Unable to load customer receivables.");
      setPayload(null);
    } else {
      setPayload(result);
      setError("");
    }
    setLoading(false);
  }, [customer.id]);

  useEffect(() => { void load(); }, [load]);

  const totalsByAccount = useMemo(
    () => new Map(payload?.accountTotals.map((total) => [total.account_id, total]) ?? []),
    [payload?.accountTotals],
  );
  const latestInvoices = payload?.obligations.filter((item) => item.obligation_type === "invoice").slice(0, 5) ?? [];
  const hasMixedCurrencies = new Set(payload?.accounts.map((account) => account.currency) ?? []).size > 1;

  async function createAccount() {
    setSaving(true);
    setError("");
    const editingAccount = payload?.accounts.find((account) => account.id === editingAccountId);
    const response = await fetch(`/api/debtors/${customer.id}/receivables`, {
      method: editingAccountId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "account",
        ...(editingAccountId ? { account_id: editingAccountId } : {}),
        ...accountForm,
        currency: editingAccount?.currency ?? configuration.settings.defaultCurrency,
        metadata: editingAccount?.metadata ?? {},
        custom_fields: editingAccount?.custom_fields ?? {},
      }),
    });
    const result = await response.json().catch(() => ({})) as { error?: string };
    setSaving(false);
    if (!response.ok) {
      setError(result.error ?? "Unable to create the account.");
      return;
    }
    setAccountForm(emptyAccount);
    setEditingAccountId(null);
    setFormMode(null);
    await load();
  }

  async function createInvoice() {
    setSaving(true);
    setError("");
    const response = await fetch(`/api/debtors/${customer.id}/receivables`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "obligation",
        ...invoiceForm,
        issue_date: invoiceForm.issue_date || null,
        purchase_order_reference: invoiceForm.purchase_order_reference || null,
        obligation_type: "invoice",
        currency: payload?.accounts.find((account) => account.id === invoiceForm.account_id)?.currency ?? configuration.settings.defaultCurrency,
        adjustments: "0",
        paid_amount: "0",
        metadata: {},
        custom_fields: {},
      }),
    });
    const result = await response.json().catch(() => ({})) as { error?: string };
    setSaving(false);
    if (!response.ok) {
      setError(result.error ?? "Unable to create the invoice.");
      return;
    }
    setInvoiceForm(emptyInvoice);
    setFormMode(null);
    await load();
  }

  async function chase(target: "invoice" | "account", accountId: string, obligationId?: string) {
    const chaseKey = obligationId ?? accountId;
    setChasing(chaseKey);
    setError("");
    const response = await fetch(`/api/debtors/${customer.id}/receivables`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "chase",
        target,
        account_id: accountId,
        obligation_id: obligationId,
        payment_lock_mode: "approval",
      }),
    });
    const result = await response.json().catch(() => ({})) as {
      recoveryCase?: { case_id?: unknown };
      error?: string;
    };
    setChasing("");
    if (!response.ok) {
      setError(result.error ?? "Unable to start recovery.");
      return;
    }
    const caseId = result.recoveryCase?.case_id;
    if (typeof caseId !== "string" || !/^CB-[A-Za-z0-9-]+$/.test(caseId)) {
      setError("Recovery case created, but its identifier was invalid.");
      return;
    }
    router.push(`/cases/${caseId}?created=1`);
  }

  function beginInvoice(accountId = "") {
    setInvoiceForm({ ...emptyInvoice, account_id: accountId });
    setFormMode("invoice");
    setError("");
  }

  function beginAccount() {
    setEditingAccountId(null);
    setAccountForm(emptyAccount);
    setFormMode("account");
    setError("");
  }

  function editAccount(account: CustomerAccountRow) {
    setEditingAccountId(account.id);
    setAccountForm({
      display_name: account.display_name,
      account_number: account.account_number ?? "",
      account_type: account.account_type,
      account_mode: account.account_mode,
      credit_limit: account.credit_limit_minor == null ? "" : (account.credit_limit_minor / 100).toFixed(2),
      credit_warning_threshold_percent: account.credit_warning_threshold_percent,
    });
    setFormMode("account");
    setError("");
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-overview-title"
        className="h-full w-full max-w-3xl overflow-y-auto bg-[#F7F8FA] pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-2xl"
      >
        <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-gray-100 bg-white px-4 py-4 sm:px-6">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Customer Overview</p>
            <h2 id="customer-overview-title" className="truncate text-xl font-black text-[#0D1B3D]">
              {customerName(customer)}
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">Consolidated accounts, invoices and recovery coverage</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close customer overview" className="flex h-11 w-11 items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="space-y-4 px-4 py-4 sm:px-6">
          <CustomerTaxDetailsPanel debtorId={customer.id} />
          {error && <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
          {loading ? (
            <p className="rounded-2xl bg-white p-6 text-sm text-gray-500">Loading customer accounts…</p>
          ) : payload && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Metric label="Outstanding" value={hasMixedCurrencies ? payload.totalsByCurrency.map((total) => formatMinor(total.outstanding_minor, total.currency)).join(" · ") : formatMinor(payload.totals.outstanding_minor, payload.accounts[0]?.currency)} emphasis />
                <Metric label="Contractual due" value={hasMixedCurrencies ? payload.totalsByCurrency.map((total) => formatMinor(total.contractual_due_minor, total.currency)).join(" · ") : formatMinor(payload.totals.contractual_due_minor, payload.accounts[0]?.currency)} />
                <Metric label="Paid" value={hasMixedCurrencies ? payload.totalsByCurrency.map((total) => formatMinor(total.paid_minor, total.currency)).join(" · ") : formatMinor(payload.totals.paid_minor, payload.accounts[0]?.currency)} />
                <Metric label="Open invoices" value={String(payload.obligations.filter((item) =>
                  item.obligation_type === "invoice"
                  && item.outstanding_minor > 0
                  && !["paid", "void", "written_off"].includes(item.status)
                ).length)} />
              </div>

              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={beginAccount} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#0D1B3D] px-4 py-2 text-sm font-bold text-white">
                  <Plus className="h-4 w-4" /> Add account
                </button>
                <button type="button" disabled={payload.accounts.length === 0} onClick={() => beginInvoice()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#009966] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                  <FilePlus2 className="h-4 w-4" /> Add invoice
                </button>
              </div>

              {formMode === "account" && (
                <AccountEditor
                  editing={Boolean(editingAccountId)}
                  form={accountForm}
                  setForm={setAccountForm}
                  saving={saving}
                  currency={configuration.settings.defaultCurrency}
                  cancel={() => { setFormMode(null); setEditingAccountId(null); }}
                  save={() => void createAccount()}
                />
              )}
              {formMode === "invoice" && (
                <InvoiceEditor accounts={payload.accounts} form={invoiceForm} setForm={setInvoiceForm} saving={saving} currency={payload.accounts.find((account) => account.id === invoiceForm.account_id)?.currency ?? configuration.settings.defaultCurrency} cancel={() => setFormMode(null)} save={() => void createInvoice()} />
              )}

              <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center gap-2">
                  <Layers3 className="h-4 w-4 text-[#009966]" />
                  <h3 className="text-sm font-black text-[#0D1B3D]">Accounts</h3>
                </div>
                {payload.accounts.length === 0 ? (
                  <p className="text-sm text-gray-500">No customer account yet. Add one before creating invoices.</p>
                ) : (
                  <div className="space-y-3">
                    {payload.accounts.map((account) => {
                      const totals = totalsByAccount.get(account.id);
                      const invoices = payload.obligations.filter((item) => item.account_id === account.id);
                      return (
                        <AccountCard
                          key={account.id}
                          account={account}
                          totals={totals}
                          invoices={invoices}
                          enforcementEnabled={payload.creditLimitEnforcementEnabled}
                          chasing={chasing}
                          edit={() => editAccount(account)}
                          addInvoice={() => beginInvoice(account.id)}
                          chaseInvoice={(invoiceId) => void chase("invoice", account.id, invoiceId)}
                          chaseAccount={() => void chase("account", account.id)}
                        />
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center gap-2">
                  <ReceiptText className="h-4 w-4 text-[#009966]" />
                  <h3 className="text-sm font-black text-[#0D1B3D]">Latest invoices</h3>
                </div>
                {latestInvoices.length === 0 ? <p className="text-sm text-gray-500">No invoices yet.</p> : latestInvoices.map((invoice) => (
                  <div key={invoice.id} className="flex items-center justify-between gap-3 border-b border-gray-100 py-2.5 last:border-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-gray-800">{invoice.reference}</p>
                      <p className="text-[11px] text-gray-500">Due {formatCalendarDate(invoice.due_date, configuration.settings)} · {titleCase(invoice.status)}</p>
                    </div>
                    <p className="shrink-0 text-sm font-black text-[#0D1B3D]">{formatMinor(invoice.outstanding_minor, invoice.currency)}</p>
                  </div>
                ))}
              </section>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return <div className="rounded-2xl border border-gray-100 bg-white p-3 shadow-sm"><p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{label}</p><p className={`mt-1 truncate text-base font-black ${emphasis ? "text-red-600" : "text-[#0D1B3D]"}`}>{value}</p></div>;
}

function AccountCard({
  account, totals, invoices, enforcementEnabled, chasing, edit, addInvoice, chaseInvoice, chaseAccount,
}: {
  account: CustomerAccountRow;
  totals?: AccountReceivableTotalsRow;
  invoices: ObligationRow[];
  enforcementEnabled: boolean;
  chasing: string;
  edit: () => void;
  addInvoice: () => void;
  chaseInvoice: (invoiceId: string) => void;
  chaseAccount: () => void;
}) {
  const { configuration } = useRegion();
  const formatMinor = (value: number) => formatMinorCurrency(value, configuration.settings, account.currency);
  const { statuses: einvoices, reload: reloadEinvoices } = useEinvoiceStatuses(invoices.slice(0, 4).map((invoice) => invoice.id));
  const openInvoices = invoices.filter((item) => item.outstanding_minor > 0 && !["paid", "void", "written_off"].includes(item.status));
  const warning = totals?.credit_warning ?? "no_limit";
  const warningStyle = warning === "over_limit" || warning === "limit_reached"
    ? "border-red-200 bg-red-50 text-red-700"
    : warning === "approaching_limit"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-emerald-100 bg-emerald-50 text-emerald-700";

  return (
    <article className="rounded-2xl border border-gray-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-black text-gray-900">{account.display_name}</p>
          <p className="text-[11px] text-gray-500">{titleCase(account.account_type)} · {account.account_mode === "ongoing" ? "Ongoing / Recurring" : "One-Off"}{account.account_number ? ` · ${account.account_number}` : ""}</p>
        </div>
        <span className={`rounded-full border px-2 py-1 text-[10px] font-bold ${warningStyle}`}>
          {creditWarningLabel(warning)}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SmallMetric label="Exposure" value={formatMinor(totals?.current_exposure_minor ?? 0)} />
        <SmallMetric label="Credit limit" value={totals?.credit_limit_minor == null ? "Not set" : formatMinor(totals.credit_limit_minor)} />
        <SmallMetric label="Available" value={totals?.available_credit_minor == null ? "—" : formatMinor(totals.available_credit_minor)} />
        <SmallMetric label="Utilization" value={totals?.utilization_percentage == null ? "—" : `${totals.utilization_percentage}%`} />
      </div>
      {totals?.credit_limit_minor != null && (
        <p className="mt-2 text-[10px] text-gray-500">
          Warning at {totals.credit_warning_threshold_percent}% · {enforcementEnabled ? "Business enforcement enabled" : "Advisory only"}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={edit} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-gray-200 px-3 text-xs font-bold text-gray-700"><Pencil className="h-3 w-3" />Edit account</button>
        <button type="button" onClick={addInvoice} className="min-h-10 rounded-lg border border-gray-200 px-3 text-xs font-bold text-gray-700">Add invoice</button>
        <button type="button" disabled={openInvoices.length === 0 || chasing === account.id} onClick={chaseAccount} className="inline-flex min-h-10 items-center gap-1 rounded-lg bg-[#0D1B3D] px-3 text-xs font-bold text-white disabled:opacity-50">
          {chasing === account.id ? "Starting…" : `Chase account balance (${openInvoices.length})`} <ArrowRight className="h-3 w-3" />
        </button>
      </div>

      {account.account_mode === "ongoing" && (
        <RecurringChargesPanel accountId={account.id} currency={account.currency} formatMinor={formatMinor} />
      )}

      {invoices.length > 0 && <div className="mt-3 border-t border-gray-100 pt-2">
        {invoices.slice(0, 4).map((invoice) => (
          <div key={invoice.id} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-bold text-gray-800">{invoice.reference}</p>
              <p className="text-[10px] text-gray-500">Due {formatCalendarDate(invoice.due_date, configuration.settings)} · {titleCase(invoice.status)}</p>
              {!["draft", "void"].includes(invoice.status) && <EinvoiceActions obligationId={invoice.id} status={einvoices.get(invoice.id)} onChanged={() => void reloadEinvoices()} />}
            </div>
            <p className="text-xs font-black text-[#0D1B3D]">{formatMinor(invoice.outstanding_minor)}</p>
            <button type="button" disabled={invoice.outstanding_minor === 0 || chasing === invoice.id} onClick={() => chaseInvoice(invoice.id)} className="min-h-9 rounded-lg bg-emerald-50 px-2.5 text-[10px] font-bold text-emerald-700 disabled:opacity-50">
              {chasing === invoice.id ? "Starting…" : "Chase invoice"}
            </button>
          </div>
        ))}
      </div>}
    </article>
  );
}

function SmallMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-[#F7F8FA] p-2.5"><p className="text-[9px] font-bold uppercase text-gray-400">{label}</p><p className="mt-0.5 truncate text-xs font-black text-gray-800">{value}</p></div>;
}

function AccountEditor({
  editing, form, setForm, saving, currency, cancel, save,
}: {
  editing: boolean;
  form: AccountForm;
  setForm: React.Dispatch<React.SetStateAction<AccountForm>>;
  saving: boolean;
  currency: string;
  cancel: () => void;
  save: () => void;
}) {
  return <div className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
    <h3 className="text-sm font-black text-[#0D1B3D]">{editing ? "Edit customer account" : "New customer account"}</h3>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <Field label="Account name" value={form.display_name} onChange={(value) => setForm((current) => ({ ...current, display_name: value }))} placeholder="e.g. Monthly supply account" />
      <Field label="Account number (optional)" value={form.account_number} onChange={(value) => setForm((current) => ({ ...current, account_number: value }))} />
      <label className="text-xs font-bold text-gray-700">Business use<select value={form.account_type} onChange={(event) => setForm((current) => ({ ...current, account_type: event.target.value as CustomerAccountType }))} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-normal">
        {["general", "corporate", "supplier", "rental", "vehicle", "property", "project", "catering_event", "future"].map((value) => <option key={value} value={value}>{titleCase(value)}</option>)}
      </select></label>
      <label className="text-xs font-bold text-gray-700">Account type<select value={form.account_mode} onChange={(event) => setForm((current) => ({ ...current, account_mode: event.target.value as CustomerAccountMode }))} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-normal">
        <option value="one_off">One-Off</option><option value="ongoing">Ongoing / Recurring</option>
      </select></label>
      <Field label={`Credit limit (${currency}, optional)`} value={form.credit_limit} onChange={(value) => setForm((current) => ({ ...current, credit_limit: value }))} inputMode="decimal" />
      <Field label="Warning threshold (%)" value={String(form.credit_warning_threshold_percent)} onChange={(value) => setForm((current) => ({ ...current, credit_warning_threshold_percent: Number(value) }))} inputMode="numeric" />
    </div>
    <p className="mt-2 text-[10px] text-gray-500">Warnings are advisory unless Credit Limit Policy enforcement is enabled in Business Settings.</p>
    <EditorActions saving={saving} cancel={cancel} save={save} label={editing ? "Save account" : "Create account"} />
  </div>;
}

function InvoiceEditor({
  accounts, form, setForm, saving, currency, cancel, save,
}: {
  accounts: CustomerAccountRow[];
  form: InvoiceForm;
  setForm: React.Dispatch<React.SetStateAction<InvoiceForm>>;
  saving: boolean;
  currency: string;
  cancel: () => void;
  save: () => void;
}) {
  return <div className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
    <h3 className="text-sm font-black text-[#0D1B3D]">New invoice</h3>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="text-xs font-bold text-gray-700">Customer account<select value={form.account_id} onChange={(event) => setForm((current) => ({ ...current, account_id: event.target.value }))} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-normal">
        <option value="">Select account</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.display_name}</option>)}
      </select></label>
      <Field label="Invoice number" value={form.reference} onChange={(value) => setForm((current) => ({ ...current, reference: value }))} />
      <Field label="PO reference (optional)" value={form.purchase_order_reference} onChange={(value) => setForm((current) => ({ ...current, purchase_order_reference: value }))} />
      <Field label={`Amount (${currency})`} value={form.original_amount} onChange={(value) => setForm((current) => ({ ...current, original_amount: value }))} inputMode="decimal" />
      <Field label="Issue date (optional)" value={form.issue_date} onChange={(value) => setForm((current) => ({ ...current, issue_date: value }))} type="date" />
      <Field label="Due date" value={form.due_date} onChange={(value) => setForm((current) => ({ ...current, due_date: value }))} type="date" />
    </div>
    <EditorActions saving={saving} cancel={cancel} save={save} label="Create invoice" />
  </div>;
}

function Field({ label, value, onChange, placeholder, type = "text", inputMode }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string; inputMode?: "decimal" | "numeric" }) {
  return <label className="text-xs font-bold text-gray-700">{label}<input type={type} inputMode={inputMode} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100" /></label>;
}

function EditorActions({ saving, cancel, save, label }: { saving: boolean; cancel: () => void; save: () => void; label: string }) {
  return <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={cancel} className="min-h-11 rounded-xl border border-gray-200 px-4 text-sm font-bold text-gray-600">Cancel</button><button type="button" disabled={saving} onClick={save} className="min-h-11 rounded-xl bg-[#009966] px-4 text-sm font-bold text-white disabled:opacity-50">{saving ? "Saving…" : label}</button></div>;
}
