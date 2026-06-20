"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { PrimaryButton } from "@/components/ui/primary-button";
import { AuthShell } from "@/components/pages/auth/auth-shell";
import { createBusiness } from "@/lib/db/businesses";
import { setMockBusinessComplete } from "@/lib/auth/mock-session";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { track } from "@/lib/analytics/tracker";
import { type PaymentLockMode } from "@/lib/supabase/types";
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

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProfileForm {
  businessName:    string;
  registrationNo:  string;
  ownerName:       string;
  phone:           string;
  email:           string;
  address:         string;
  language:        "ms" | "en";
  paymentLockMode: PaymentLockMode;
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

export function BusinessProfilePage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [loading, setLoading] = useState(false);
  const [globalError, setGlobalError] = useState("");

  const [form, setForm] = useState<ProfileForm>({
    businessName:    "",
    registrationNo:  "",
    ownerName:       "",
    phone:           "",
    email:           "",
    address:         "",
    language:        "en",
    paymentLockMode: "approval",
  });

  const [errors, setErrors] = useState<Partial<ProfileForm>>({});

  function update<K extends keyof ProfileForm>(key: K, val: ProfileForm[K]) {
    setForm((prev) => ({ ...prev, [key]: val }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function validateStep1(): boolean {
    const errs: Partial<ProfileForm> = {};
    if (!form.businessName.trim()) errs.businessName = "Business name is required.";
    if (!form.ownerName.trim())    errs.ownerName    = "Owner name is required.";
    if (!form.phone.trim())        errs.phone        = "Phone number is required.";
    if (!form.email.trim())        errs.email        = "Email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
                                   errs.email        = "Please enter a valid email.";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleStep1Next(e: React.FormEvent) {
    e.preventDefault();
    if (validateStep1()) setStep(2);
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
      router.push("/");
      return;
    }

    const result = await createBusiness({
      owner_id:        "pending", // replaced by Supabase auth.uid() in real flow
      business_name:   form.businessName,
      registration_no: form.registrationNo || null,
      phone:           form.phone,
      email:           form.email,
      address:         form.address || null,
    });

    if (result.error) {
      setGlobalError(result.error);
      setLoading(false);
      return;
    }

    track("business_profile_created", { payment_lock_mode: form.paymentLockMode });
    router.push("/");
  }

  return (
    <AuthShell maxWidth="md">
      {/* Progress indicator */}
      <div className="flex items-center gap-3 mb-6">
        {[1, 2].map((s) => (
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
            {s < 2 && (
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
          Step {step} of 2
        </span>
      </div>

      {step === 1 ? (
        <>
          <div className="mb-5">
            <h1 className="text-2xl font-black text-[#0D1B3D]">Set Up Your Business</h1>
            <p className="text-sm text-gray-500 mt-1 leading-relaxed">
              Tell us about your business so we can set up your account correctly.
            </p>
          </div>

          <form onSubmit={handleStep1Next}>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col gap-4">
              <FormField
                label="Business Name"
                placeholder="e.g. Syarikat Maju Jaya Sdn Bhd"
                value={form.businessName}
                onChange={(v) => update("businessName", v)}
                error={errors.businessName}
                icon={<Building2 className="w-4 h-4" />}
                required
              />
              <FormField
                label="Company Registration Number"
                placeholder="e.g. 202401012345"
                value={form.registrationNo}
                onChange={(v) => update("registrationNo", v)}
                icon={<Hash className="w-4 h-4" />}
                optional
                hint="SSM registration number"
              />
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
                label="Business Email"
                placeholder="e.g. accounts@mybusiness.com.my"
                value={form.email}
                onChange={(v) => update("email", v)}
                error={errors.email}
                icon={<Mail className="w-4 h-4" />}
                type="email"
                required
              />
              <FormField
                label="Business Address"
                placeholder="e.g. No. 1, Jalan Maju, 50480 Kuala Lumpur"
                value={form.address}
                onChange={(v) => update("address", v)}
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
                  ⚠️ {globalError}
                </div>
              )}

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
