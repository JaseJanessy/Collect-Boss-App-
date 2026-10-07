"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Check, Loader2, Phone, Smartphone, User } from "lucide-react";

import { AuthCard, AuthError, AuthField, AuthShell } from "./auth-shell";
import { PrimaryButton } from "@/components/ui/primary-button";
import { ProductQuiz } from "@/components/onboarding/product-quiz";
import { getBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  MAIN_COLLECTBOSS_RULES,
  MAIN_RULES_VERSION,
  type RegistrationProduct,
} from "@collectboss/registration-contracts";
import { PLANS } from "@/lib/billing/plans";
import type { PlanSlug } from "@/lib/billing/types";

type WorkspaceResponse = {
  workspace?: { product?: RegistrationProduct };
  error?: string;
};

export function ProductSelectionPage({ selectedPlan, preferredProduct }: { selectedPlan?: PlanSlug; preferredProduct?: RegistrationProduct }) {
  const router = useRouter();
  const [product, setProduct] = useState<RegistrationProduct | null>(selectedPlan ? "main" : preferredProduct ?? null);
  const [fullName, setFullName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [phone, setPhone] = useState("");
  const [rulesAccepted, setRulesAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fullNameError, setFullNameError] = useState("");
  const [accountNameError, setAccountNameError] = useState("");
  const [phoneError, setPhoneError] = useState("");

  function selectProduct(next: RegistrationProduct) {
    setProduct(next);
    setRulesAccepted(false);
    setError("");
  }

  function validate(): boolean {
    setError("");
    setFullNameError("");
    setAccountNameError("");
    setPhoneError("");
    let valid = true;
    if (!product) {
      setError("Choose CollectBoss or CollectBoss Pocket.");
      valid = false;
    }
    if (fullName.trim().length < 2) {
      setFullNameError("Enter your full name.");
      valid = false;
    }
    if (accountName.trim().length < 2) {
      setAccountNameError("Enter your business or account name.");
      valid = false;
    }
    if (!/^[+()\-\s.0-9]{7,30}$/u.test(phone.trim())) {
      setPhoneError("Enter a valid phone number.");
      valid = false;
    }
    if (product === "main" && !rulesAccepted) {
      setError("Read and accept all Main CollectBoss rules before continuing.");
      valid = false;
    }
    return valid;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!validate() || !product) return;
    setLoading(true);
    setError("");

    if (!isSupabaseConfigured) {
      router.push(product === "main" && selectedPlan ? `/onboarding/profile?plan=${selectedPlan}` : product === "main" ? "/onboarding/profile" : "/pocket");
      return;
    }

    const client = getBrowserClient();
    const { data: sessionData } = client ? await client.auth.getSession() : { data: { session: null } };
    if (!sessionData.session) {
      setError("Your secure session has expired. Sign in again to choose a product.");
      setLoading(false);
      return;
    }

    const response = await fetch("/api/workspace/provision", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sessionData.session.access_token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        fullName,
        accountName,
        phone,
        product,
        mainRulesAccepted: product === "main" && rulesAccepted,
        mainRulesVersion: MAIN_RULES_VERSION,
      }),
    });
    const payload = await response.json().catch(() => null) as WorkspaceResponse | null;
    if (!response.ok) {
      setError(payload?.error ?? "Unable to complete your CollectBoss product selection.");
      setLoading(false);
      return;
    }

    const selectedProduct = payload?.workspace?.product ?? product;
    router.push(selectedProduct === "main" && selectedPlan ? `/onboarding/profile?plan=${selectedPlan}` : selectedProduct === "main" ? "/onboarding/profile" : "/pocket");
    router.refresh();
  }

  return (
    <AuthShell maxWidth="md">
      <div className="mb-6">
        <div className="mb-3 flex items-center gap-2 text-xs font-bold text-gray-500">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#009966] text-white"><Check className="h-3.5 w-3.5" /></span>
          <span>Account created</span>
          <span className="h-px flex-1 bg-gray-200" />
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0D1B3D] text-white">2</span>
          <span>Choose product</span>
        </div>
        <h1 className="text-2xl font-black text-[#0D1B3D]">Choose your CollectBoss experience</h1>
        <p className="mt-1 text-sm leading-relaxed text-gray-500">
          Your email and password are shared across the CollectBoss web and mobile apps. Choose the workspace this account should open.
        </p>
        <p className="mt-2 text-xs font-semibold text-gray-500">Step 2 of 3 · About 4 minutes remaining</p>
        {selectedPlan && (
          <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
            Your {PLANS[selectedPlan].name} plan choice is saved for CollectBoss. You can still choose Pocket instead.
          </p>
        )}
      </div>

      <AuthCard>
        <form onSubmit={submit} className="flex flex-col gap-5">
          {error && <AuthError message={error} />}

          <ProductQuiz onChoose={selectProduct} chooseLabel="Choose this product" />

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-bold text-gray-700">Product</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {([
                { id: "main", title: "CollectBoss", copy: "Complete collection operations, controls and reporting.", icon: Building2 },
                { id: "pocket", title: "CollectBoss Pocket", copy: "Mobile-first essentials for everyday collection work.", icon: Smartphone },
              ] as const).map((option) => {
                const selected = product === option.id;
                const Icon = option.icon;
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => selectProduct(option.id)}
                    className={`min-h-24 rounded-2xl border-2 p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007A52] focus-visible:ring-offset-2 ${selected ? "border-[#009966] bg-[#E8F7F2]" : "border-gray-200 bg-white hover:border-gray-300"}`}
                  >
                    <span className="flex items-center gap-2 text-base font-black text-[#0D1B3D]"><Icon className="h-5 w-5" />{option.title}</span>
                    <span className="mt-2 block text-xs leading-relaxed text-gray-500">{option.copy}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          {product && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <AuthField label="Full Name" placeholder="Your full name" value={fullName} onChange={setFullName} error={fullNameError} icon={<User className="h-4 w-4" />} autoComplete="name" />
              <AuthField label="Business or Account Name" placeholder="Company or personal account name" value={accountName} onChange={setAccountName} error={accountNameError} icon={<Building2 className="h-4 w-4" />} autoComplete="organization" />
              <div className="sm:col-span-2">
                <AuthField label="Phone Number" type="tel" placeholder="e.g. +60 12 345 6789" value={phone} onChange={setPhone} error={phoneError} icon={<Phone className="h-4 w-4" />} autoComplete="tel" />
              </div>
            </div>
          )}

          {product === "main" && (
            <section aria-labelledby="main-rules-title" className="rounded-2xl border-2 border-[#0D1B3D] bg-[#F7F9FC] p-4 sm:p-5">
              <h2 id="main-rules-title" className="text-base font-black text-[#0D1B3D]">Main CollectBoss strict-use rules</h2>
              <p className="mt-1 text-xs leading-relaxed text-gray-600">These rules protect customers, debtors and your organisation. Main CollectBoss cannot be activated until you agree.</p>
              <ol className="mt-4 flex list-decimal flex-col gap-2 pl-5 text-xs leading-relaxed text-gray-700">
                {MAIN_COLLECTBOSS_RULES.map((rule) => <li key={rule}>{rule}</li>)}
              </ol>
              <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 bg-white p-3 text-sm font-bold text-[#0D1B3D]">
                <input
                  type="checkbox"
                  checked={rulesAccepted}
                  onChange={(event) => setRulesAccepted(event.target.checked)}
                  className="mt-0.5 h-5 w-5 accent-[#009966]"
                />
                <span>I have read and agree to all Main CollectBoss rules and the linked legal policies.</span>
              </label>
              <p className="mt-3 text-[11px] leading-relaxed text-gray-500">
                Review the <Link href="/terms" className="font-bold text-[#007A52] hover:underline">Terms</Link>,{" "}
                <Link href="/privacy" className="font-bold text-[#007A52] hover:underline">Privacy Policy</Link>,{" "}
                <Link href="/pdpa-consent" className="font-bold text-[#007A52] hover:underline">PDPA Notice</Link> and{" "}
                <Link href="/legal-disclaimer" className="font-bold text-[#007A52] hover:underline">Legal Disclaimer</Link>.
              </p>
            </section>
          )}

          {product && (
            <PrimaryButton
              type="submit"
              fullWidth
              size="lg"
              disabled={loading || (product === "main" && !rulesAccepted)}
              icon={loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            >
              {loading ? "Preparing workspace…" : product === "main" ? "Agree and Continue to CollectBoss" : "Continue to CollectBoss Pocket"}
            </PrimaryButton>
          )}
        </form>
      </AuthCard>
    </AuthShell>
  );
}
