"use client";

import { useState } from "react";
import { Loader2, Minus, Plus, Users } from "lucide-react";
import { requestJson } from "@/lib/data/http-service";
import { PLANS } from "@/lib/billing/plans";
import type { EntitlementRow } from "@/lib/billing/types";

const SEAT_PRICE_RM = 10;
const MAX_SEATS = 100;

/** Lets owners on a paid plan buy extra team members at RM10 each per month. */
export function ExtraSeatsCard({ entitlement, onChanged }: { entitlement: EntitlementRow; onChanged?: () => void }) {
  const current = entitlement.extra_seats ?? 0;
  const included = PLANS[entitlement.plan_slug]?.team_member_limit ?? entitlement.team_member_limit - current;
  const [quantity, setQuantity] = useState(current);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  if (entitlement.plan_slug === "free" || included === -1) return null;

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      await requestJson("/api/billing/extra-seats", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ quantity }),
      }, "We couldn't update your team seats. Please try again.");
      setMessage({ tone: "ok", text: "Saved. Your new team size will show here within a minute." });
      onChanged?.();
    } catch (cause) {
      setMessage({ tone: "error", text: cause instanceof Error ? cause.message : "We couldn't update your team seats." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="extra-seats-heading" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Users className="size-5" aria-hidden="true" /></span>
        <div className="min-w-0">
          <h2 id="extra-seats-heading" className="text-base font-black text-[#0D1B3D]">Extra team members</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Your {PLANS[entitlement.plan_slug]?.name} plan includes {included} {included === 1 ? "person" : "people"}. Add more for RM{SEAT_PRICE_RM} each per month.
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center rounded-xl border border-slate-200">
          <button type="button" aria-label="Remove one team member" disabled={saving || quantity <= 0} onClick={() => setQuantity((value) => Math.max(0, value - 1))} className="flex size-11 items-center justify-center text-slate-700 disabled:opacity-40"><Minus className="size-4" /></button>
          <output aria-live="polite" className="w-12 text-center text-lg font-black text-[#0D1B3D]">{quantity}</output>
          <button type="button" aria-label="Add one team member" disabled={saving || quantity >= MAX_SEATS} onClick={() => setQuantity((value) => Math.min(MAX_SEATS, value + 1))} className="flex size-11 items-center justify-center text-slate-700 disabled:opacity-40"><Plus className="size-4" /></button>
        </div>
        <p className="text-sm text-slate-600">
          Team size <strong className="text-[#0D1B3D]">{included + quantity}</strong> · Extra <strong className="text-[#0D1B3D]">RM{quantity * SEAT_PRICE_RM}/month</strong>
        </p>
        <button type="button" disabled={saving || quantity === current} onClick={() => void save()} className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--cb-action-primary)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          {saving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}Save
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500">Changes are prorated on your next invoice.</p>
      {message && <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "mt-2 text-sm text-red-700" : "mt-2 text-sm text-emerald-700"}>{message.text}</p>}
    </section>
  );
}
