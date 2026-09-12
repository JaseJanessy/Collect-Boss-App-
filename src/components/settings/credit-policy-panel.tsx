"use client";

import { useState } from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import type { BusinessProfileDto } from "@/lib/business-profile/types";

export function CreditPolicyPanel({
  profile,
  refresh,
}: {
  profile: BusinessProfileDto | null;
  refresh: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const enforced = profile?.creditLimitEnforcementEnabled ?? false;

  async function toggle() {
    setSaving(true);
    setError("");
    const response = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creditLimitEnforcementEnabled: !enforced }),
    });
    const payload = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      setError(payload.error ?? "Unable to update the credit-limit policy.");
      setSaving(false);
      return;
    }
    await refresh();
    setSaving(false);
  }

  return (
    <SectionCard title="Credit Limit Policy">
      <div className="mt-2 flex items-start gap-3">
        <div className={`rounded-xl p-2 ${enforced ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
          {enforced ? <AlertTriangle className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-gray-800">
            {enforced ? "Workflow enforcement enabled" : "Advisory warnings only"}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
            {enforced
              ? "New or increased invoices are blocked when projected exposure exceeds an account credit limit. Payments and credits are never blocked."
              : "Approaching-limit and over-limit warnings remain visible, but invoice workflows continue."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enforced}
          aria-label="Enforce account credit limits"
          disabled={saving || !profile}
          onClick={() => void toggle()}
          className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${enforced ? "bg-amber-500" : "bg-gray-300"}`}
        >
          <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${enforced ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>
      <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-[10px] leading-relaxed text-blue-700">
        Each account has its own limit and transparent warning threshold. This business-level switch is the only setting that changes warnings into workflow enforcement.
      </p>
      {error && <p className="mt-2 text-xs font-semibold text-red-600">{error}</p>}
    </SectionCard>
  );
}
