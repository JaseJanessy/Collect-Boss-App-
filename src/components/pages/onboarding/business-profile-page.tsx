"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { CustomerImportPanel } from "@/components/operations/customer-import-panel";
import { PrimaryButton } from "@/components/ui/primary-button";
import { AuthShell } from "@/components/pages/auth/auth-shell";
import { setMockBusinessComplete } from "@/lib/auth/mock-session";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { track } from "@/lib/analytics/tracker";
import { type AccountType, type PaymentLockMode } from "@/lib/supabase/types";
import { useBusinessProfile } from "@/hooks/use-business-profile";
import type { BusinessIndustry, BusinessProfileDto } from "@/lib/business-profile/types";
import { businessProfileSchema, type BusinessProfileInput } from "@/lib/business-profile/validation";
import {
  Building2,
  Hash,
  User,
  Phone,
  Mail,
  MapPin,
  Globe,
  ShieldCheck,
  Eye,
  Lock,
  CheckCircle2,
  Loader2,
  Info,
} from "lucide-react";
import { PLANS } from "@/lib/billing/plans";
import type { PlanSlug } from "@/lib/billing/types";
import { useT } from "@/contexts/language-context";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProfileForm {
  accountType:     AccountType | "";
  businessName:    string;
  legalName:       string;
  registrationNo:  string;
  industry:        BusinessIndustry;
  ownerName:       string;
  phone:           string;
  email:           string;
  address:         string;
  language:        "ms" | "en";
  paymentLockMode: PaymentLockMode;
}

function createProfileForm(profile: BusinessProfileDto | null): ProfileForm {
  return {
    accountType: profile?.accountType ?? "",
    businessName: profile?.displayName ?? "",
    legalName: profile?.legalName ?? "",
    registrationNo: profile?.registrationNo ?? "",
    industry: profile?.industry ?? "general",
    ownerName: profile?.contactName ?? "",
    phone: profile?.phone ?? "",
    email: profile?.email ?? "",
    address: profile?.address ?? "",
    language: "en",
    paymentLockMode: "approval",
  };
}

function toProfileInput(form: ProfileForm): BusinessProfileInput | Record<string, unknown> {
  return {
    accountType: form.accountType,
    displayName: form.businessName,
    legalName: form.legalName,
    contactName: form.ownerName,
    registrationNo: form.registrationNo.trim() || null,
    industry: form.industry,
    phone: form.phone,
    email: form.email,
    address: form.address.trim() || null,
  };
}

// ─── Lock mode options ────────────────────────────────────────────────────────

const lockModes: Array<{
  mode:        PaymentLockMode;
  icon:        React.ReactNode;
  label:       string;
  description: string;
  recommended?: boolean;
}> = [
  {
    mode:        "approval",
    icon:        <ShieldCheck className="w-5 h-5" />,
    label:       "Require Approval First",
    description: "You approve each request before debtor sees payment details.",
    recommended: true,
  },
  {
    mode:        "immediate",
    icon:        <Eye className="w-5 h-5" />,
    label:       "Show Immediately",
    description: "Debtor can view payment details right away.",
  },
  {
    mode:        "manual",
    icon:        <Lock className="w-5 h-5" />,
    label:       "Send Manually Only",
    description: "You send payment details yourself each time.",
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

export function BusinessProfilePage({ selectedPlan }: { selectedPlan?: PlanSlug }) {
  const { profile, loading, error, refresh } = useBusinessProfile();

  if (isSupabaseConfigured && loading) {
    return (
      <AuthShell maxWidth="md">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 flex flex-col items-center gap-3">
          <Loader2 className="w-5 h-5 text-[#009966] animate-spin" />
          <p className="text-sm text-gray-500">Loading your profile…</p>
        </div>
      </AuthShell>
    );
  }

  return (
    <BusinessProfileForm
      key={profile?.id ?? "new-profile"}
      initialProfile={profile}
      loadError={error}
      onRetry={refresh}
      selectedPlan={selectedPlan}
    />
  );
}

function BusinessProfileForm({
  initialProfile,
  loadError,
  onRetry,
  selectedPlan,
}: {
  initialProfile: BusinessProfileDto | null;
  loadError: string | null;
  onRetry: () => Promise<void>;
  selectedPlan?: PlanSlug;
}) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const totalSteps = initialProfile ? 2 : 3;
  const t = useT();
  const [importedRows, setImportedRows] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [globalError, setGlobalError] = useState("");

  const [form, setForm] = useState<ProfileForm>(() => createProfileForm(initialProfile));

  const [errors, setErrors] = useState<Partial<Record<keyof ProfileForm, string>>>({});

  function update<K extends keyof ProfileForm>(key: K, val: ProfileForm[K]) {
    setForm((prev) => ({ ...prev, [key]: val }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function validateStep1(): boolean {
    const parsed = businessProfileSchema.safeParse(toProfileInput(form));
    if (parsed.success) {
      setErrors({});
      return true;
    }

    const fields = parsed.error.flatten().fieldErrors;
    const errs: Partial<Record<keyof ProfileForm, string>> = {
      accountType: fields.accountType?.[0] ?? (!form.accountType ? "Choose individual or business." : undefined),
      businessName: fields.displayName?.[0],
      legalName: fields.legalName?.[0],
      ownerName: fields.contactName?.[0],
      registrationNo: fields.registrationNo?.[0],
      industry: fields.industry?.[0],
      phone: fields.phone?.[0],
      email: fields.email?.[0],
      address: fields.address?.[0],
    };
    setErrors(errs);
    return false;
  }

  function handleStep1Next(e: React.FormEvent) {
    e.preventDefault();
    if (!validateStep1()) return;

    if (
      initialProfile?.accountType === "business" &&
      form.accountType === "individual" &&
      !window.confirm("Changing to an individual account will remove the saved business registration number when you save. Continue?")
    ) {
      return;
    }

    setStep(2);
  }

  // Paid plans continue to checkout; first-time free setups can import customers.
  function finishSetup() {
    if (selectedPlan && selectedPlan !== "free") {
      router.push(`/billing?plan=${selectedPlan}`);
    } else if (!initialProfile) {
      setLoading(false);
      setStep(3);
    } else {
      router.push("/");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setGlobalError("");

    if (!isSupabaseConfigured) {
      // Mock mode — just mark profile as complete
      setMockBusinessComplete();
      await new Promise((r) => setTimeout(r, 600)); // simulate save
      track("business_profile_created", { payment_lock_mode: form.paymentLockMode });
      finishSetup();
      return;
    }

    const response = await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toProfileInput(form)),
    });
    const result = await response.json().catch(() => ({ error: "Unable to save profile." })) as { error?: string };

    if (!response.ok) {
      setGlobalError(
        response.status === 401
          ? "Your session has expired. Sign in again, then retry your saved details."
          : result.error ?? "Unable to save profile."
      );
      setLoading(false);
      return;
    }

    track("business_profile_created", { payment_lock_mode: form.paymentLockMode });
    finishSetup();
  }

  return (
    <AuthShell maxWidth="md">
      {selectedPlan && (
        <p className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
          Step 3 of 3 · About 3 minutes · {PLANS[selectedPlan].name} plan selected
        </p>
      )}
      {/* Progress indicator */}
      <div className="flex items-center gap-3 mb-6">
        {Array.from({ length: totalSteps }, (_, index) => index + 1).map((s) => (
          <div key={s} className="flex items-center gap-2 flex-1">
            <div
              className={cn(
                "w-7 h-7 rounded-full flex items-center justify-center text-xs font-black transition-colors",
                s < step
                  ? "bg-[#009966] text-white"
                  : s === step
                  ? "bg-[#0D1B3D] text-white"
                  : "bg-gray-200 text-gray-400"
              )}
            >
              {s < step ? <CheckCircle2 className="w-4 h-4" /> : s}
            </div>
            {s < totalSteps && (
              <div
                className={cn(
                  "flex-1 h-0.5 transition-colors",
                  s < step ? "bg-[#009966]" : "bg-gray-200"
                )}
              />
            )}
          </div>
        ))}
        <span className="text-xs text-gray-400 ml-1 shrink-0">
          Step {step} of {totalSteps}
        </span>
      </div>

      {step === 3 ? (
        <div className="flex flex-col gap-4">
          <div>
            <h1 className="text-2xl font-black text-[#0D1B3D]">{t("onboarding.importTitle")}</h1>
            <p className="mt-1 text-sm leading-relaxed text-gray-500">
              {t("onboarding.importBody")}
            </p>
          </div>
          <CustomerImportPanel onImported={setImportedRows} />
          {importedRows !== null && (
            <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
              {importedRows} {importedRows === 1 ? "customer is" : "customers are"} ready in your workspace.
            </p>
          )}
          <PrimaryButton type="button" size="lg" onClick={() => router.push(importedRows ? "/cases" : "/")}>
            {importedRows ? t("onboarding.viewCustomers") : t("onboarding.skip")}
          </PrimaryButton>
        </div>
      ) : step === 1 ? (
        <>
          <div className="mb-5">
            <h1 className="text-2xl font-black text-[#0D1B3D]">
              {initialProfile ? "Edit Your Profile" : "Set Up Your Account"}
            </h1>
            <p className="text-sm text-gray-500 mt-1 leading-relaxed">
              Choose the account type that matches how you collect debt. Your legal identity appears on generated documents.
            </p>
          </div>

          {loadError && (
            <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800">
              {loadError === "You must be signed in." ? (
                <>
                  <p>Your session has expired. Sign in again to resume your profile.</p>
                  <button type="button" onClick={() => router.push("/login")} className="mt-2 font-bold text-[#009966] hover:underline">
                    Sign in again
                  </button>
                </>
              ) : (
                <>
                  <p>{loadError}</p>
                  <button type="button" onClick={() => void onRetry()} className="mt-2 font-bold text-[#009966] hover:underline">
                    Retry profile load
                  </button>
                </>
              )}
            </div>
          )}

          <form onSubmit={handleStep1Next}>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-bold text-gray-700">Account Type</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="group" aria-label="Account type">
                  {([
                    { value: "individual" as const, label: "Individual", detail: "Collect in your own legal name", icon: <User className="w-4 h-4" /> },
                    { value: "business" as const, label: "Business", detail: "Collect for a registered organisation", icon: <Building2 className="w-4 h-4" /> },
                  ]).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-label={`${option.label}: ${option.detail}`}
                      aria-pressed={form.accountType === option.value}
                      onClick={() => update("accountType", option.value)}
                      className={cn(
                        "flex items-start gap-3 rounded-xl border-2 p-3 text-left transition-colors",
                        form.accountType === option.value
                          ? "border-[#009966] bg-emerald-50 text-[#007A52]"
                          : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                      )}
                    >
                      <span className="mt-0.5">{option.icon}</span>
                      <span>
                        <span className="block text-sm font-bold">{option.label}</span>
                        <span className="block mt-0.5 text-[11px] leading-relaxed text-gray-500">{option.detail}</span>
                      </span>
                    </button>
                  ))}
                </div>
                {errors.accountType && <p className="text-xs text-red-500 ml-1">{errors.accountType}</p>}
                <p className="text-[11px] text-gray-400 ml-1">A logo is optional. Your legal name remains the document identity until one is added.</p>
              </div>
              <FormField
                label={form.accountType === "individual" ? "Display Name" : "Business Name"}
                placeholder={form.accountType === "individual" ? "e.g. Ahmad bin Hassan" : "e.g. Syarikat Maju Jaya Sdn Bhd"}
                value={form.businessName}
                onChange={(v) => update("businessName", v)}
                error={errors.businessName}
                icon={<Building2 className="w-4 h-4" />}
                required
              />
              <FormField
                label={form.accountType === "individual" ? "Legal Name" : "Registered Legal Name"}
                placeholder={form.accountType === "individual" ? "e.g. Ahmad bin Hassan" : "e.g. Syarikat Maju Jaya Sdn Bhd"}
                value={form.legalName}
                onChange={(v) => update("legalName", v)}
                error={errors.legalName}
                icon={<User className="w-4 h-4" />}
                required
              />
              {form.accountType !== "individual" && (
              <FormField
                label="Company Registration Number"
                placeholder="e.g. 202401012345"
                value={form.registrationNo}
                onChange={(v) => update("registrationNo", v)}
                icon={<Hash className="w-4 h-4" />}
                error={errors.registrationNo}
                required={form.accountType === "business"}
                hint="SSM registration number"
              />
              )}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-bold text-gray-700" htmlFor="business-industry">Industry</label>
                <select
                  id="business-industry"
                  value={form.industry}
                  onChange={(event) => update("industry", event.target.value as BusinessIndustry)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm text-gray-700"
                >
                  <option value="general">General business</option>
                  <option value="professional_services">Professional services</option>
                  <option value="retail">Retail</option>
                  <option value="construction">Construction</option>
                  <option value="property">Property</option>
                  <option value="education">Education</option>
                  <option value="healthcare">Healthcare</option>
                  <option value="financial_services">Financial services</option>
                  <option value="financing_money_lending">Financing / money lending</option>
                  <option value="other">Other</option>
                </select>
                {errors.industry && <p className="ml-1 text-xs text-red-500">{errors.industry}</p>}
                <p className="ml-1 text-[11px] text-gray-400">
                  Industry is used for risk-based review. Financing and money-lending businesses may need licence review before payment links are enabled.
                </p>
              </div>
              <FormField
                label="Owner / Contact Name"
                placeholder="e.g. Ahmad bin Hassan"
                value={form.ownerName}
                onChange={(v) => update("ownerName", v)}
                error={errors.ownerName}
                icon={<User className="w-4 h-4" />}
                required
              />
              <FormField
                label="Phone Number"
                placeholder="e.g. +60 12-345 6789"
                value={form.phone}
                onChange={(v) => update("phone", v)}
                error={errors.phone}
                icon={<Phone className="w-4 h-4" />}
                type="tel"
                required
                hint="Used for WhatsApp reminders"
              />
              <FormField
                label={form.accountType === "individual" ? "Email Address" : "Business Email"}
                placeholder={form.accountType === "individual" ? "e.g. ahmad@example.com" : "e.g. accounts@mybusiness.com.my"}
                value={form.email}
                onChange={(v) => update("email", v)}
                error={errors.email}
                icon={<Mail className="w-4 h-4" />}
                type="email"
                required
              />
              <FormField
                label={form.accountType === "individual" ? "Postal Address" : "Business Address"}
                placeholder="e.g. No. 1, Jalan Maju, 50480 Kuala Lumpur"
                value={form.address}
                onChange={(v) => update("address", v)}
                error={errors.address}
                icon={<MapPin className="w-4 h-4" />}
                optional
              />

              {/* Language */}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-bold text-gray-700">
                  Preferred Language
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(["en", "ms"] as const).map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      aria-pressed={form.language === lang}
                      onClick={() => update("language", lang)}
                      className={cn(
                        "flex items-center gap-2 px-4 py-3 rounded-xl border-2 text-sm font-semibold transition-all",
                        form.language === lang
                          ? "border-[#009966] bg-emerald-50 text-[#009966]"
                          : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                      )}
                    >
                      <Globe className="w-4 h-4" />
                      {lang === "en" ? "English" : "Bahasa Malaysia"}
                    </button>
                  ))}
                </div>
              </div>

              <PrimaryButton type="submit" fullWidth size="lg">
                Continue →
              </PrimaryButton>
            </div>
          </form>
        </>
      ) : (
        <>
          <div className="mb-5">
            <h1 className="text-2xl font-black text-[#0D1B3D]">Payment Security</h1>
            <p className="text-sm text-gray-500 mt-1 leading-relaxed">
              Choose how debtors access your payment details by default.
              You can change this per case later.
            </p>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col gap-4">
              {globalError && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-700 font-medium">
                  <p>⚠️ {globalError}</p>
                  {globalError.startsWith("Your session has expired") && (
                    <button type="button" onClick={() => router.push("/login")} className="mt-2 font-bold underline">
                      Sign in again
                    </button>
                  )}
                </div>
              )}

              <div className="bg-[#F2F4F7] border border-gray-200 rounded-xl p-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Document identity preview</p>
                <p className="mt-1 text-sm font-bold text-[#0D1B3D]">{form.legalName.trim() || "Your legal name"}</p>
                <p className="mt-1 text-[11px] text-gray-500">This name will appear as the creditor on generated documents.</p>
              </div>

              {/* Lock mode cards */}
              <div className="flex flex-col gap-2">
                {lockModes.map((opt) => (
                  <button
                    key={opt.mode}
                    type="button"
                    onClick={() => update("paymentLockMode", opt.mode)}
                    className={cn(
                      "flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all",
                      form.paymentLockMode === opt.mode
                        ? "border-[#009966] bg-emerald-50"
                        : "border-gray-100 bg-white hover:border-gray-200"
                    )}
                  >
                    {/* Radio */}
                    <div
                      className={cn(
                        "w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5",
                        form.paymentLockMode === opt.mode
                          ? "border-[#009966] bg-[#009966]"
                          : "border-gray-300"
                      )}
                    >
                      {form.paymentLockMode === opt.mode && (
                        <div className="w-1.5 h-1.5 bg-white rounded-full" />
                      )}
                    </div>

                    <div
                      className={cn(
                        "w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
                        form.paymentLockMode === opt.mode
                          ? "bg-[#009966] text-white"
                          : "bg-gray-100 text-gray-500"
                      )}
                    >
                      {opt.icon}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-gray-900">{opt.label}</p>
                        {opt.recommended && (
                          <span className="text-[9px] font-bold text-[#009966] bg-emerald-100 px-1.5 py-0.5 rounded-full">
                            Recommended
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
                        {opt.description}
                      </p>
                    </div>
                  </button>
                ))}
              </div>

              {/* Security notice */}
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 flex gap-2.5">
                <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                <p className="text-[11px] text-blue-700 leading-relaxed">
                  Payment details are <strong>never shown publicly</strong>. This setting
                  controls when your debtors can request to see your bank details.
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="flex-1 py-3 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  ← Back
                </button>
                <PrimaryButton
                  type="submit"
                  size="lg"
                  disabled={loading}
                  className="flex-1"
                  icon={loading ? <Loader2 className="w-4 h-4 animate-spin" /> : undefined}
                >
                  {loading ? "Saving…" : "Complete Setup"}
                </PrimaryButton>
              </div>
            </div>
          </form>
        </>
      )}
    </AuthShell>
  );
}

// ─── Form field helper ────────────────────────────────────────────────────────

function FormField({
  label,
  placeholder,
  value,
  onChange,
  error,
  icon,
  type = "text",
  required,
  optional,
  hint,
}: {
  label:       string;
  placeholder: string;
  value:       string;
  onChange:    (v: string) => void;
  error?:      string;
  icon?:       React.ReactNode;
  type?:       string;
  required?:   boolean;
  optional?:   boolean;
  hint?:       string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-bold text-gray-700">
        {label}
        {optional && (
          <span className="text-xs font-normal text-gray-400 ml-1">(Optional)</span>
        )}
      </label>
      <div className="relative">
        {icon && (
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
            {icon}
          </div>
        )}
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          className={cn(
            "w-full py-3.5 pr-4 border rounded-xl text-sm text-gray-900 placeholder:text-gray-400 outline-none transition-all",
            icon ? "pl-10" : "pl-4",
            error
              ? "border-red-300 focus:ring-2 focus:ring-red-100 bg-red-50"
              : "border-gray-200 focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300"
          )}
        />
      </div>
      {error && <p className="text-xs text-red-500 ml-1">{error}</p>}
      {hint && !error && <p className="text-[11px] text-gray-400 ml-1">{hint}</p>}
    </div>
  );
}
