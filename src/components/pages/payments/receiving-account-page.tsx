"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SectionCard } from "@/components/ui/section-card";
import { PrimaryButton } from "@/components/ui/primary-button";
import { InlineSpinner, LoadingSpinner } from "@/components/ui/loading-spinner";
import { type ReceivingAccountRow, type ReceivingAccountUpdate } from "@/lib/supabase/types";
import { useReceivingAccounts } from "@/hooks/use-receiving-accounts";
import { useBusinessId } from "@/hooks/use-business-id";
import {
  saveReceivingAccountClient,
  updateReceivingAccountClient,
  deleteReceivingAccountClient,
  setPrimaryAccountClient,
} from "@/lib/db/receiving-accounts-client";
import { appendAuditLogClient } from "@/lib/db/audit-logs-client";
import {
  Building2, Copy, Check, QrCode, Bell, ChevronLeft,
  Plus, Star, Edit3, Trash2, X, AlertCircle, Save,
  Shield, Loader2,
} from "lucide-react";

// ─── Form state ───────────────────────────────────────────────────────────────

interface AccountFormValues {
  bank_name:            string;
  account_holder_name:  string;
  account_number:       string;
  duitnow_id:           string;
  include_in_reminders: boolean;
  is_primary:           boolean;
}

const emptyForm: AccountFormValues = {
  bank_name:            "",
  account_holder_name:  "",
  account_number:       "",
  duitnow_id:           "",
  include_in_reminders: true,
  is_primary:           false,
};

function rowToForm(row: ReceivingAccountRow): AccountFormValues {
  return {
    bank_name:            row.bank_name,
    account_holder_name:  row.account_holder_name,
    account_number:       row.account_number,
    duitnow_id:           row.duitnow_id ?? "",
    include_in_reminders: row.include_in_reminders,
    is_primary:           row.is_primary,
  };
}

function validateForm(v: AccountFormValues): string | null {
  if (!v.bank_name.trim())           return "Bank name is required.";
  if (!v.account_holder_name.trim()) return "Account holder name is required.";
  if (v.account_number.replace(/\s/g, "").length < 6)
    return "Account number must be at least 6 digits.";
  return null;
}

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(value).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="flex items-center gap-1 text-xs font-semibold text-[#009966] hover:text-emerald-700 transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ─── Toggle switch ────────────────────────────────────────────────────────────

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={cn(
        "relative w-11 h-6 rounded-full transition-colors shrink-0",
        checked ? "bg-[#009966]" : "bg-gray-200"
      )}
    >
      <span className={cn(
        "absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all",
        checked ? "left-[22px]" : "left-0.5"
      )} />
    </button>
  );
}

// ─── Account card (read mode) ─────────────────────────────────────────────────

function AccountCard({
  account,
  onEdit,
  onDelete,
  onSetPrimary,
  isDeleting,
}: {
  account:      ReceivingAccountRow;
  onEdit:       () => void;
  onDelete:     () => void;
  onSetPrimary: () => void;
  isDeleting:   boolean;
}) {
  const bankColors: Record<string, string> = {
    maybank: "bg-amber-400", cimb: "bg-red-500",
    public: "bg-blue-600", rhb: "bg-emerald-600",
    hong: "bg-red-600", ambank: "bg-purple-600",
  };
  const colorKey = account.bank_name.toLowerCase().split(" ")[0];
  const logoColor = bankColors[colorKey] ?? "bg-blue-500";

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-50">
        <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0", logoColor)}>
          <Building2 className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900">{account.bank_name}</p>
          {account.is_primary && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full mt-0.5">
              <Star className="w-2.5 h-2.5" /> Primary
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!account.is_primary && (
            <button
              onClick={onSetPrimary}
              className="p-1.5 text-gray-300 hover:text-amber-500 transition-colors"
              title="Set as primary"
            >
              <Star className="w-3.5 h-3.5" />
            </button>
          )}
          <button onClick={onEdit} className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors">
            <Edit3 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onDelete}
            disabled={isDeleting}
            className="p-1.5 text-gray-300 hover:text-red-400 transition-colors"
          >
            {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Details */}
      <div className="px-4 py-3 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div><p className="text-[11px] text-gray-400">Account Holder</p><p className="text-sm font-semibold text-gray-800 mt-0.5">{account.account_holder_name}</p></div>
          <CopyButton value={account.account_holder_name} />
        </div>
        <div className="flex items-center justify-between">
          <div><p className="text-[11px] text-gray-400">Account Number</p><p className="text-sm font-semibold text-gray-800 mt-0.5 font-mono">{account.account_number}</p></div>
          <CopyButton value={account.account_number} />
        </div>
      </div>

      {/* DuitNow */}
      {account.duitnow_id && (
        <div className="mx-4 mb-3 bg-[#F2F4F7] rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2">
            <QrCode className="w-4 h-4 text-[#009966]" />
            <span className="text-xs font-bold text-gray-800">DuitNow</span>
          </div>
          <div className="flex gap-3 items-center">
            <div className="w-16 h-16 bg-white rounded-xl border-2 border-dashed border-[#009966]/30 flex items-center justify-center shrink-0">
              <QrCode className="w-7 h-7 text-[#009966]/40" />
            </div>
            <div>
              <p className="text-[10px] text-gray-400">DuitNow ID</p>
              <p className="text-sm font-bold text-gray-800 font-mono mt-0.5">{account.duitnow_id}</p>
              <CopyButton value={account.duitnow_id} />
            </div>
          </div>
        </div>
      )}

      {/* Reminder toggle */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-gray-50">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-gray-400" />
          <div>
            <p className="text-xs font-semibold text-gray-700">Include in Reminders</p>
            <p className="text-[11px] text-gray-400">Show in WhatsApp &amp; email reminders</p>
          </div>
        </div>
        <span className={cn(
          "text-[10px] font-bold px-2 py-0.5 rounded-full",
          account.include_in_reminders ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"
        )}>
          {account.include_in_reminders ? "ON" : "OFF"}
        </span>
      </div>
    </div>
  );
}

// ─── Account form (create / edit) ─────────────────────────────────────────────

function AccountForm({
  initialValues,
  onSave,
  onCancel,
  saving,
  error,
  isNew,
}: {
  initialValues: AccountFormValues;
  onSave:        (v: AccountFormValues) => void;
  onCancel:      () => void;
  saving:        boolean;
  error:         string | null;
  isNew:         boolean;
}) {
  const [v, setV] = useState<AccountFormValues>(initialValues);
  const set = (key: keyof AccountFormValues, val: string | boolean) =>
    setV((prev) => ({ ...prev, [key]: val }));

  return (
    <div className="bg-white rounded-2xl border-2 border-[#009966] p-4 flex flex-col gap-4">
      <p className="text-sm font-bold text-[#0D1B3D]">
        {isNew ? "Add New Account" : "Edit Account"}
      </p>

      <FormInput label="Bank Name *" placeholder="e.g. Maybank Berhad" value={v.bank_name}
        onChange={(val) => set("bank_name", val)} />
      <FormInput label="Account Holder Name *" placeholder="e.g. Syarikat ABC Sdn Bhd"
        value={v.account_holder_name} onChange={(val) => set("account_holder_name", val)} />
      <FormInput label="Account Number *" placeholder="e.g. 1234 5678 9012"
        value={v.account_number} onChange={(val) => set("account_number", val)} type="text" />
      <FormInput label="DuitNow ID (Optional)" placeholder="e.g. 01X-XXXXXXX or IC/SSM"
        value={v.duitnow_id} onChange={(val) => set("duitnow_id", val)} />

      <div className="flex flex-col gap-2.5">
        <ToggleRow
          label="Include in Reminders"
          sub="Show account details in reminder messages"
          checked={v.include_in_reminders}
          onChange={(val) => set("include_in_reminders", val)}
        />
        <ToggleRow
          label="Set as Primary Account"
          sub="Used by default for payment reminders"
          checked={v.is_primary}
          onChange={(val) => set("is_primary", val)}
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => onSave(v)}
          disabled={saving}
          className="flex-1 flex items-center justify-center gap-1.5 bg-[#009966] hover:bg-[#00B377] text-white text-sm font-bold py-2.5 rounded-xl transition-colors disabled:opacity-60"
        >
          {saving ? <InlineSpinner className="text-white" /> : <Save className="w-4 h-4" />}
          {saving ? "Saving…" : "Save Account"}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function FormInput({
  label, placeholder, value, onChange, type = "text",
}: {
  label: string; placeholder: string; value: string;
  onChange: (v: string) => void; type?: string;
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-gray-600 mb-1 block">{label}</label>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-800 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition-all"
      />
    </div>
  );
}

function ToggleRow({ label, sub, checked, onChange }: {
  label: string; sub: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-xs font-semibold text-gray-700">{label}</p>
        <p className="text-[11px] text-gray-400">{sub}</p>
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} />
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function ReceivingAccountPage() {
  const { accounts, loading, error, addAccount, patchAccount, removeAccount } =
    useReceivingAccounts();
  const businessId = useBusinessId();

  const [editingId,  setEditingId]  = useState<string | null>(null);
  const [showAdd,    setShowAdd]    = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [formError,  setFormError]  = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [savedMsg,   setSavedMsg]   = useState<string | null>(null);

  const bId = businessId ?? "mock-business-id";

  async function handleSaveEdit(id: string, v: AccountFormValues) {
    const err = validateForm(v);
    if (err) { setFormError(err); return; }
    setSaving(true);
    setFormError(null);

    const patch: ReceivingAccountUpdate = {
      bank_name:            v.bank_name.trim(),
      account_holder_name:  v.account_holder_name.trim(),
      account_number:       v.account_number.trim(),
      duitnow_id:           v.duitnow_id.trim() || null,
      include_in_reminders: v.include_in_reminders,
      is_primary:           v.is_primary,
    };

    const result = await updateReceivingAccountClient(id, patch);
    if (result.error) {
      setFormError(result.error);
    } else {
      patchAccount(id, patch);
      setEditingId(null);
      await appendAuditLogClient({
        business_id: bId, action: "receiving_account.updated",
        actor_type: "owner", metadata: { account_id: id, bank_name: patch.bank_name ?? null },
      });
      showSaved("Account updated.");
    }
    setSaving(false);
  }

  async function handleCreate(v: AccountFormValues) {
    const err = validateForm(v);
    if (err) { setFormError(err); return; }
    setSaving(true);
    setFormError(null);

    const result = await saveReceivingAccountClient({
      business_id:          bId,
      bank_name:            v.bank_name.trim(),
      account_holder_name:  v.account_holder_name.trim(),
      account_number:       v.account_number.trim(),
      duitnow_id:           v.duitnow_id.trim() || null,
      duitnow_qr_url:       null,
      include_in_reminders: v.include_in_reminders,
      is_primary:           v.is_primary,
    });

    if (result.error) {
      setFormError(result.error);
    } else {
      addAccount(result.data!);
      setShowAdd(false);
      await appendAuditLogClient({
        business_id: bId, action: "receiving_account.created",
        actor_type: "owner", metadata: { bank_name: v.bank_name.trim() },
      });
      showSaved("Account added.");
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    const result = await deleteReceivingAccountClient(id);
    if (!result.error) {
      removeAccount(id);
      await appendAuditLogClient({
        business_id: bId, action: "receiving_account.deleted",
        actor_type: "owner", metadata: { account_id: id },
      });
    }
    setDeletingId(null);
  }

  async function handleSetPrimary(id: string) {
    await setPrimaryAccountClient(id);
    patchAccount(id, { is_primary: true });
    await appendAuditLogClient({
      business_id: bId, action: "receiving_account.set_primary",
      actor_type: "owner", metadata: { account_id: id },
    });
    showSaved("Primary account updated.");
  }

  function showSaved(msg: string) {
    setSavedMsg(msg);
    setTimeout(() => setSavedMsg(null), 3000);
  }

  return (
    <div className="flex flex-col pb-6">
      <div className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/payments" className="text-gray-400 hover:text-gray-600">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-lg font-bold text-[#0D1B3D]">Receiving Accounts</h1>
        </div>
        <p className="text-xs text-gray-400 ml-7">
          Manage your bank accounts and DuitNow details.
        </p>
      </div>

      <div className="px-4 pt-5 flex flex-col gap-4">
        {/* Security notice */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 flex gap-2.5">
          <Shield className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
          <p className="text-[11px] text-blue-700 leading-relaxed">
            Payment details are only shared with debtors after your approval.
            They are never shown publicly without your permission.
          </p>
        </div>

        {/* Success message */}
        {savedMsg && (
          <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5">
            <Check className="w-3.5 h-3.5 text-emerald-600" />
            <p className="text-xs font-semibold text-emerald-700">{savedMsg}</p>
          </div>
        )}

        {/* Help tip for new users */}
        <div className="bg-[#009966]/5 border border-[#009966]/15 rounded-xl px-4 py-3 flex gap-3">
          <Shield className="w-4 h-4 text-[#009966] shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-emerald-800">Why add an account?</p>
            <p className="text-[11px] text-gray-600 mt-0.5 leading-relaxed">
              Add your bank account or DuitNow ID so debtors can pay you directly.
              Your primary account is shown on payment links sent to debtors.
            </p>
          </div>
        </div>

        {loading ? (
          <LoadingSpinner />
        ) : error ? (
          <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl p-3">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <p className="text-xs text-red-700">{error}</p>
          </div>
        ) : (
          <>
            {accounts.map((acct) =>
              editingId === acct.id ? (
                <AccountForm
                  key={acct.id}
                  initialValues={rowToForm(acct)}
                  onSave={(v) => handleSaveEdit(acct.id, v)}
                  onCancel={() => { setEditingId(null); setFormError(null); }}
                  saving={saving}
                  error={formError}
                  isNew={false}
                />
              ) : (
                <AccountCard
                  key={acct.id}
                  account={acct}
                  onEdit={() => { setEditingId(acct.id); setFormError(null); }}
                  onDelete={() => handleDelete(acct.id)}
                  onSetPrimary={() => handleSetPrimary(acct.id)}
                  isDeleting={deletingId === acct.id}
                />
              )
            )}

            {/* Empty state: no accounts yet */}
            {accounts.length === 0 && !showAdd && (
              <div className="flex flex-col items-center text-center py-8 px-4 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                <div className="w-12 h-12 bg-[#009966]/10 rounded-2xl flex items-center justify-center mb-3">
                  <Building2 className="w-6 h-6 text-[#009966]" />
                </div>
                <p className="text-sm font-bold text-gray-700">No accounts added yet</p>
                <p className="text-xs text-gray-400 mt-1 max-w-xs leading-relaxed">
                  Add your bank account or DuitNow ID to start accepting payments from debtors.
                </p>
                <button
                  onClick={() => { setShowAdd(true); setFormError(null); }}
                  className="mt-4 flex items-center gap-1.5 bg-[#009966] hover:bg-[#00B377] text-white text-sm font-bold px-4 py-2 rounded-xl transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Add Account
                </button>
              </div>
            )}

            {/* Add new account */}
            {showAdd ? (
              <AccountForm
                initialValues={{ ...emptyForm, is_primary: accounts.length === 0 }}
                onSave={handleCreate}
                onCancel={() => { setShowAdd(false); setFormError(null); }}
                saving={saving}
                error={formError}
                isNew
              />
            ) : accounts.length > 0 ? (
              <button
                onClick={() => { setShowAdd(true); setFormError(null); }}
                className="flex items-center justify-center gap-2 py-3.5 border-2 border-dashed border-gray-200 rounded-2xl text-sm font-semibold text-gray-400 hover:border-emerald-300 hover:text-[#009966] transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Another Account
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
