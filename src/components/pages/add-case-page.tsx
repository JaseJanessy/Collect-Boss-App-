"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { PrimaryButton } from "@/components/ui/primary-button";
import { InlineSpinner } from "@/components/ui/loading-spinner";
import {
  User,
  Phone,
  Mail,
  Building2,
  DollarSign,
  Calendar,
  FileText,
  Info,
  CheckCircle2,
  AlertCircle,
  MapPin,
  StickyNote,
  ShieldCheck,
  Eye,
  Lock,
} from "lucide-react";
import {
  createCaseSchema,
  type CreateCaseInput,
} from "@/lib/validations/case";
import { type DebtorType, type PaymentLockMode } from "@/lib/supabase/types";
import { createCaseClient } from "@/lib/db/cases-client";
import { appendAuditLogClient } from "@/lib/db/audit-logs-client";
import { useBusinessId } from "@/hooks/use-business-id";
import { track } from "@/lib/analytics/tracker";
import { useEntitlements } from "@/hooks/use-entitlements";
import { useCases } from "@/hooks/use-cases";
import { UpgradePrompt } from "@/components/billing/upgrade-prompt";
import { UsageMeter } from "@/components/billing/usage-meter";
import { formatLimit } from "@/lib/billing/plans";

// ─── Form state type ───────────────────────────────────────────────────────────

type FormValues = {
  debtor_type:       DebtorType;
  debtor_name:       string;
  debtor_phone:      string;
  debtor_email:      string;
  debtor_company:    string;
  debtor_reg_no:     string;
  debtor_contact_name: string;
  debtor_location:   string;
  amount_owed:       string;
  due_date:          string;
  invoice_no:        string;
  payment_lock_mode: PaymentLockMode;
  notes:             string;
};

const defaultValues: FormValues = {
  debtor_type:       "individual",
  debtor_name:       "",
  debtor_phone:      "",
  debtor_email:      "",
  debtor_company:    "",
  debtor_reg_no:     "",
  debtor_contact_name: "",
  debtor_location:   "",
  amount_owed:       "",
  due_date:          "",
  invoice_no:        "",
  payment_lock_mode: "approval",
  notes:             "",
};

// ─── Lock mode options ─────────────────────────────────────────────────────────

const lockModes: Array<{
  mode:        PaymentLockMode;
  icon:        React.ReactNode;
  label:       string;
  description: string;
}> = [
  {
    mode:        "approval",
    icon:        <ShieldCheck className="w-4 h-4" />,
    label:       "Require Approval",
    description: "You review and approve each payment access request.",
  },
  {
    mode:        "immediate",
    icon:        <Eye className="w-4 h-4" />,
    label:       "Show Immediately",
    description: "Debtor can access payment details right away.",
  },
  {
    mode:        "manual",
    icon:        <Lock className="w-4 h-4" />,
    label:       "Manual",
    description: "You control access manually at any time.",
  },
];

// ─── Main component ────────────────────────────────────────────────────────────

export function AddCasePage() {
  const router     = useRouter();
  const businessId = useBusinessId();

  const { cases, loading: casesLoading }         = useCases();
  const { entitlement, flags, loading: entLoading } = useEntitlements();

  const [step,      setStep]      = useState(1);
  const [values,    setValues]    = useState<FormValues>(defaultValues);
  const [errors,    setErrors]    = useState<Partial<Record<keyof FormValues, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const setValue = (key: keyof FormValues, val: string) => {
    setValues((prev) => ({ ...prev, [key]: val }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  // ── Step 1 validation ────────────────────────────────────────────────────────
  function validateStep1(): boolean {
    const result = createCaseSchema.safeParse(values);
    if (result.success) {
      setErrors({});
      return true;
    }
    const fieldErrors: Partial<Record<keyof FormValues, string>> = {};
    for (const issue of result.error.issues) {
      const key = issue.path[0] as keyof FormValues;
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    setErrors(fieldErrors);
    return false;
  }

  function handleContinue() {
    if (validateStep1()) setStep(2);
  }

  // ── Submit ───────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!validateStep1()) {
      setStep(1);
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    // ── Server-side limit check (defense in depth) ──────────────────────────
    try {
      const checkRes = await fetch("/api/billing/validate-action", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action: "create_case" }),
      });
      if (checkRes.ok) {
        const checkData = await checkRes.json() as { allowed: boolean; reason?: string };
        if (!checkData.allowed) {
          setSubmitError(checkData.reason ?? "You have reached your plan limit.");
          setSubmitting(false);
          return;
        }
      }
    } catch {
      // Network error — allow through (client-side check already ran)
    }

    const bId = businessId ?? "mock-business-id";
    const input: CreateCaseInput = {
      debtor_type:       values.debtor_type,
      debtor_name:       values.debtor_name,
      debtor_phone:      values.debtor_phone || undefined,
      debtor_email:      values.debtor_email || undefined,
      debtor_company:    values.debtor_company || undefined,
      debtor_reg_no:     values.debtor_reg_no || undefined,
      debtor_contact_name: values.debtor_contact_name || undefined,
      duplicate_acknowledged: false,
      debtor_location:   values.debtor_location || undefined,
      amount_owed:       values.amount_owed,
      due_date:          values.due_date,
      invoice_no:        values.invoice_no || undefined,
      payment_lock_mode: values.payment_lock_mode,
      notes:             values.notes || undefined,
    };

    const result = await createCaseClient(input, bId);

    if (result.error) {
      setSubmitError(result.error);
      setSubmitting(false);
      return;
    }

    const newCase = result.data!;

    await appendAuditLogClient({
      business_id:  newCase.business_id,
      case_id:      newCase.id,
      action:       "case.created",
      actor_type:   "owner",
      metadata: {
        debtor_name:  newCase.debtor_name,
        amount_owed:  newCase.amount_owed,
        invoice_no:   newCase.invoice_no,
      },
    });

    track("case_created", {
      payment_lock_mode: newCase.payment_lock_mode,
      has_invoice:       !!newCase.invoice_no,
    });

    router.push(`/cases/${newCase.id}?created=1`);
  }

  // ── Plan limit gate ──────────────────────────────────────────────────────────
  const caseCount = cases.length;
  const caseLimit = entitlement?.case_limit ?? 3;
  const atCaseLimit = !entLoading && !casesLoading && !flags.canCreateCase(caseCount);

  if (atCaseLimit) {
    return (
      <div className="flex flex-col pb-6">
        <div className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
          <Link href="/cases" className="text-sm text-gray-400 hover:text-gray-600">← Cases</Link>
          <h1 className="text-lg font-bold text-[#0D1B3D] mt-3">Add Case</h1>
        </div>
        <div className="px-4 pt-6">
          <UpgradePrompt
            feature="Create Case"
            reason={`Your current plan allows ${formatLimit(caseLimit)} active case${caseLimit === 1 ? "" : "s"}. You have reached your plan limit.`}
            description="Upgrade your plan to add more cases and recover more money."
            planRequired="Starter"
          />
          <div className="mt-4">
            <UsageMeter
              label="Active cases"
              current={caseCount}
              limit={caseLimit}
            />
          </div>
        </div>
      </div>
    );
  }

  if (step === 2) {
    return (
      <StepTwo
        values={values}
        setValue={setValue}
        onBack={() => setStep(1)}
        onSubmit={handleSubmit}
        submitting={submitting}
        submitError={submitError}
      />
    );
  }

  return (
    <div className="flex flex-col pb-6">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center justify-between mb-3">
          <Link href="/cases" className="text-sm text-gray-400 hover:text-gray-600">
            ✕ Cancel
          </Link>
        </div>
        <StepIndicator current={1} total={2} />
        <h1 className="text-lg font-bold text-[#0D1B3D] mt-3">Let&apos;s get the basics</h1>
        <p className="text-xs text-gray-400 mt-0.5">Enter the key details to get started.</p>
      </div>

      <div className="px-4 flex flex-col gap-4 pt-5 md:pt-8 md:max-w-2xl md:mx-auto md:w-full">
        {/* Beta help banner */}
        <div className="bg-[#0D1B3D]/5 border border-[#0D1B3D]/10 rounded-xl px-4 py-3 flex gap-3">
          <Info className="w-4 h-4 text-[#0D1B3D]/50 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-[#0D1B3D]/80">New to CollectBoss?</p>
            <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
              A <strong>case</strong> represents one debtor who owes you money.
              Fill in their name, amount owed, and due date — that&apos;s all you need to start.
            </p>
          </div>
        </div>

        {/* Debtor info section */}
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Debtor Details</p>

        <div className="grid grid-cols-2 gap-2">
          {(["individual", "business"] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setValues((previous) => ({ ...previous, debtor_type: type }))}
              className={cn(
                "rounded-xl border-2 px-3 py-2.5 text-sm font-bold transition-colors",
                values.debtor_type === type
                  ? "border-[#009966] bg-emerald-50 text-[#007A52]"
                  : "border-gray-200 text-gray-600"
              )}
            >
              {type === "individual" ? "Individual" : "Business"}
            </button>
          ))}
        </div>

        <FormField
          id="debtor_name"
          label={values.debtor_type === "individual" ? "Individual's Full Name" : "Primary Contact Name"}
          placeholder={values.debtor_type === "individual" ? "e.g. Ahmad bin Hassan" : "e.g. Accounts contact"}
          icon={<User className="w-4 h-4" />}
          value={values.debtor_name}
          onChange={(v) => setValue("debtor_name", v)}
          error={errors.debtor_name}
          required
        />
        <FormField
          id="debtor_phone"
          label="Phone Number"
          placeholder="e.g. +60 12-345 6789"
          icon={<Phone className="w-4 h-4" />}
          type="tel"
          value={values.debtor_phone}
          onChange={(v) => setValue("debtor_phone", v)}
          error={errors.debtor_phone}
          hint="Used for WhatsApp reminders"
          optional
        />
        <FormField
          id="debtor_email"
          label="Email Address"
          placeholder="e.g. billing@company.com"
          icon={<Mail className="w-4 h-4" />}
          type="email"
          value={values.debtor_email}
          onChange={(v) => setValue("debtor_email", v)}
          error={errors.debtor_email}
          optional
        />
        {values.debtor_type === "business" && (
          <>
            <FormField
              id="debtor_company"
              label="Registered Business Name"
              placeholder="e.g. Maju Enterprise Sdn Bhd"
              icon={<Building2 className="w-4 h-4" />}
              value={values.debtor_company}
              onChange={(v) => setValue("debtor_company", v)}
              error={errors.debtor_company}
              required
            />
            <FormField
              id="debtor_reg_no"
              label="Registration Number"
              placeholder="e.g. 202401012345"
              icon={<Building2 className="w-4 h-4" />}
              value={values.debtor_reg_no}
              onChange={(v) => setValue("debtor_reg_no", v)}
              error={errors.debtor_reg_no}
              optional
            />
            <FormField
              id="debtor_contact_name"
              label="Contact Name"
              placeholder="e.g. Accounts contact"
              icon={<User className="w-4 h-4" />}
              value={values.debtor_contact_name}
              onChange={(v) => setValue("debtor_contact_name", v)}
              error={errors.debtor_contact_name}
              optional
            />
          </>
        )}
        <FormField
          id="debtor_location"
          label="Correspondence Address"
          placeholder="e.g. No. 1, Jalan Maju, Kuala Lumpur"
          icon={<MapPin className="w-4 h-4" />}
          value={values.debtor_location}
          onChange={(v) => setValue("debtor_location", v)}
          error={errors.debtor_location}
          optional
        />

        {/* Debt info section */}
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mt-2">Debt Details</p>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-gray-700">
            Amount Owed (RM)
            <RequiredDot />
          </label>
          <div className="relative">
            <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
              <DollarSign className="w-4 h-4" />
            </div>
            <div className="absolute left-9 top-1/2 -translate-y-1/2 text-sm font-semibold text-gray-500 pointer-events-none">
              RM
            </div>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={values.amount_owed}
              onChange={(e) => setValue("amount_owed", e.target.value)}
              className={cn(
                "w-full pl-16 pr-4 py-3.5 bg-white border rounded-xl text-sm text-gray-800 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition-all",
                errors.amount_owed ? "border-red-300 ring-2 ring-red-100" : "border-gray-200"
              )}
            />
          </div>
          {errors.amount_owed && (
            <p className="text-[11px] text-red-500 ml-1">{errors.amount_owed}</p>
          )}
        </div>

        <FormField
          id="due_date"
          label="Due Date"
          placeholder="Select due date"
          icon={<Calendar className="w-4 h-4" />}
          type="date"
          value={values.due_date}
          onChange={(v) => setValue("due_date", v)}
          error={errors.due_date}
          required
        />
        <FormField
          id="invoice_no"
          label="Invoice Number"
          placeholder="e.g. INV-2024-0001"
          icon={<FileText className="w-4 h-4" />}
          value={values.invoice_no}
          onChange={(v) => setValue("invoice_no", v)}
          error={errors.invoice_no}
          optional
        />

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-gray-700">
            Notes
            <span className="text-xs text-gray-400 font-normal ml-1">(Optional)</span>
          </label>
          <div className="relative">
            <div className="absolute left-3.5 top-3.5 text-gray-400">
              <StickyNote className="w-4 h-4" />
            </div>
            <textarea
              rows={3}
              placeholder="Any additional context about this debtor or debt…"
              value={values.notes}
              onChange={(e) => setValue("notes", e.target.value)}
              className={cn(
                "w-full pl-10 pr-4 py-3.5 bg-white border rounded-xl text-sm text-gray-800 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition-all resize-none",
                errors.notes ? "border-red-300 ring-2 ring-red-100" : "border-gray-200"
              )}
            />
          </div>
          {errors.notes && <p className="text-[11px] text-red-500 ml-1">{errors.notes}</p>}
        </div>

        {/* Info notice */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex gap-3">
          <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-blue-800">You can add documents later</p>
            <p className="text-[11px] text-blue-600 mt-0.5 leading-relaxed">
              Upload invoices, contracts, and evidence after the case is created.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-2 pb-6">
          <PrimaryButton fullWidth size="lg" onClick={handleContinue}>
            Continue
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

// ─── Step 2: Payment mode + review ────────────────────────────────────────────

function StepTwo({
  values,
  setValue,
  onBack,
  onSubmit,
  submitting,
  submitError,
}: {
  values:      FormValues;
  setValue:    (k: keyof FormValues, v: string) => void;
  onBack:      () => void;
  onSubmit:    () => void;
  submitting:  boolean;
  submitError: string | null;
}) {
  const amount = parseFloat(values.amount_owed) || 0;
  const { entitlement } = useEntitlements();
  const paymentLockEnabled = entitlement?.payment_lock_enabled ?? false;

  return (
    <div className="flex flex-col pb-6">
      <div className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center justify-between mb-3">
          <button onClick={onBack} className="text-sm text-gray-400 hover:text-gray-600">
            ← Back
          </button>
        </div>
        <StepIndicator current={2} total={2} />
        <h1 className="text-lg font-bold text-[#0D1B3D] mt-3">Review &amp; Confirm</h1>
        <p className="text-xs text-gray-400 mt-0.5">Check the details before creating this case.</p>
      </div>

      <div className="px-4 flex flex-col gap-4 pt-5 md:pt-8 md:max-w-2xl md:mx-auto md:w-full">
        {/* Summary card */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3">
          {[
            { label: "Customer / Debtor",  value: values.debtor_name        || "—" },
            { label: "Phone Number",       value: values.debtor_phone       || "Not provided" },
            { label: "Email",              value: values.debtor_email       || "Not provided" },
            { label: "Company",            value: values.debtor_company     || "Not provided" },
            { label: "Amount Owed",        value: amount > 0 ? `RM ${amount.toLocaleString("en-MY", { minimumFractionDigits: 2 })}` : "—" },
            { label: "Balance",            value: amount > 0 ? `RM ${amount.toLocaleString("en-MY", { minimumFractionDigits: 2 })}` : "—" },
            { label: "Due Date",           value: values.due_date           || "—" },
            { label: "Invoice Number",     value: values.invoice_no         || "Not provided" },
          ].map((row) => (
            <div key={row.label} className="flex items-center justify-between">
              <span className="text-xs text-gray-400">{row.label}</span>
              <span className="text-sm font-semibold text-gray-900">{row.value}</span>
            </div>
          ))}
        </div>

        {/* Payment lock mode */}
        <div>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
            Payment Access Mode
          </p>
          <div className="flex flex-col gap-2">
            {lockModes.map(({ mode, icon, label, description }) => {
              // "approval" mode requires Payment Lock entitlement
              const isLocked = mode === "approval" && !paymentLockEnabled;
              return (
                <button
                  key={mode}
                  type="button"
                  disabled={isLocked}
                  onClick={() => !isLocked && setValue("payment_lock_mode", mode)}
                  className={cn(
                    "flex items-start gap-3 text-left p-3 rounded-xl border-2 transition-all",
                    isLocked
                      ? "border-gray-100 bg-gray-50 cursor-not-allowed opacity-60"
                      : values.payment_lock_mode === mode
                      ? "border-[#009966] bg-emerald-50"
                      : "border-gray-200 bg-white hover:border-gray-300"
                  )}
                >
                  <div
                    className={cn(
                      "w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
                      values.payment_lock_mode === mode && !isLocked
                        ? "bg-[#009966] text-white"
                        : "bg-gray-100 text-gray-500"
                    )}
                  >
                    {icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className={cn(
                        "text-xs font-bold",
                        values.payment_lock_mode === mode && !isLocked ? "text-[#009966]" : "text-gray-700"
                      )}>
                        {label}
                      </p>
                      {isLocked && (
                        <span className="text-[9px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                          Upgrade to unlock
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{description}</p>
                  </div>
                  <div
                    className={cn(
                      "w-4 h-4 rounded-full border-2 shrink-0 mt-1 flex items-center justify-center",
                      values.payment_lock_mode === mode && !isLocked
                        ? "border-[#009966] bg-[#009966]"
                        : "border-gray-300"
                    )}
                  >
                    {values.payment_lock_mode === mode && !isLocked && (
                      <div className="w-1.5 h-1.5 rounded-full bg-white" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* What happens next */}
        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4">
          <p className="text-xs font-bold text-emerald-800 mb-2">What happens next</p>
          <div className="flex flex-col gap-2">
            {[
              "Case is created and added to your list",
              "CollectBoss suggests the best next action",
              "You can upload documents and evidence",
            ].map((s) => (
              <div key={s} className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                <p className="text-[11px] text-emerald-700">{s}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Error state */}
        {submitError && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-100 rounded-xl p-4">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <p className="text-xs text-red-700">{submitError}</p>
          </div>
        )}

        <div className="flex flex-col gap-2 pb-6">
          <PrimaryButton
            fullWidth
            size="lg"
            onClick={onSubmit}
            disabled={submitting}
            icon={submitting ? <InlineSpinner className="text-white" /> : undefined}
          >
            {submitting ? "Creating Case…" : "Create Case"}
          </PrimaryButton>
          <PrimaryButton fullWidth variant="ghost" size="md" onClick={onBack} disabled={submitting}>
            Edit Details
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

// ─── Shared field component ────────────────────────────────────────────────────

function RequiredDot() {
  return <span className="text-red-400 ml-0.5">*</span>;
}

function FormField({
  id,
  label,
  placeholder,
  icon,
  type = "text",
  value,
  onChange,
  error,
  hint,
  required,
  optional,
}: {
  id:          string;
  label:       string;
  placeholder: string;
  icon:        React.ReactNode;
  type?:       string;
  value:       string;
  onChange:    (v: string) => void;
  error?:      string;
  hint?:       string;
  required?:   boolean;
  optional?:   boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-gray-700">
        {label}
        {required && <RequiredDot />}
        {optional && (
          <span className="text-xs text-gray-400 font-normal ml-1">(Optional)</span>
        )}
      </label>
      <div className="relative">
        <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">{icon}</div>
        <input
          id={id}
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            "w-full pl-10 pr-4 py-3.5 bg-white border rounded-xl text-sm text-gray-800 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition-all",
            error ? "border-red-300 ring-2 ring-red-100" : "border-gray-200"
          )}
        />
      </div>
      {error && <p className="text-[11px] text-red-500 ml-1">{error}</p>}
      {hint && !error && <p className="text-[11px] text-gray-400 ml-1">{hint}</p>}
    </div>
  );
}

// ─── Step indicator ────────────────────────────────────────────────────────────

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }, (_, i) => i + 1).map((s) => (
        <div key={s} className="flex items-center gap-2">
          <div
            className={cn(
              "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors",
              s < current
                ? "bg-[#009966] text-white"
                : s === current
                ? "bg-[#0D1B3D] text-white"
                : "bg-gray-200 text-gray-400"
            )}
          >
            {s < current ? <CheckCircle2 className="w-3.5 h-3.5" /> : s}
          </div>
          {s < total && (
            <div
              className={cn("flex-1 h-0.5 w-8", s < current ? "bg-[#009966]" : "bg-gray-200")}
            />
          )}
        </div>
      ))}
      <span className="text-xs text-gray-400 ml-1">Step {current} of {total}</span>
    </div>
  );
}
