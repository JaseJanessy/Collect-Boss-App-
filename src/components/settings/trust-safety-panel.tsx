"use client";
import { friendlyErrorMessage } from "@/lib/ui/friendly-error";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";
import { PrimaryButton } from "@/components/ui/primary-button";
import type { BusinessProfileDto } from "@/lib/business-profile/types";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { industryNeedsAdditionalReview, verificationDisplayLabel } from "@/lib/business-profile/risk";

interface SafetyReport {
  id: string;
  case_id: string;
  category: string;
  details: string | null;
  tenant_review_status: "pending" | "acknowledged" | "resolved";
  platform_review_required: boolean;
  restriction_applied_until: string | null;
  created_at: string;
}

const reasonLabels: Record<string, string> = {
  do_not_recognise_business: "Do Not Recognise Business",
  do_not_recognise_amount: "Do Not Recognise Amount",
  wrong_payment_details: "Wrong Payment Details",
  suspicious_payment_request: "Suspicious Payment Request",
  suspected_illegal_lending: "Suspected Illegal Lending",
  other: "Other",
  unrecognised_debt: "Unrecognised debt (legacy)",
  creditor_details_wrong: "Creditor details wrong (legacy)",
  payment_details_suspicious: "Payment details suspicious (legacy)",
  unexpected_link: "Unexpected link (legacy)",
};

export function TrustSafetyPanel({ profile }: { profile: BusinessProfileDto | null }) {
  const [reports, setReports] = useState<SafetyReport[]>([]);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [error, setError] = useState<string | null>(null);
  const [registrationReference, setRegistrationReference] = useState("");
  const [licenceReference, setLicenceReference] = useState("");
  const [ownerNote, setOwnerNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const refreshReports = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    try {
      const response = await fetch("/api/abuse-reports", { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as { reports?: SafetyReport[]; error?: string };
      if (!response.ok) throw new Error(friendlyErrorMessage(payload.error ?? "Unable to load safety reports."));
      setReports(payload.reports ?? []);
      setError(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to load safety reports.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let active = true;
    void fetch("/api/abuse-reports", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as { reports?: SafetyReport[]; error?: string };
        if (!response.ok) throw new Error(friendlyErrorMessage(payload.error ?? "Unable to load safety reports."));
        return payload.reports ?? [];
      })
      .then((loadedReports) => {
        if (active) {
          setReports(loadedReports);
          setError(null);
        }
      })
      .catch((error: unknown) => {
        if (active) setError(error instanceof Error ? error.message : "Unable to load safety reports.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  async function requestVerification(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/business-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registrationDocumentReference: registrationReference,
          licenceDocumentReference: licenceReference,
          ownerNote,
        }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(friendlyErrorMessage(payload.error ?? "Unable to request verification."));
      window.location.reload();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to request verification.");
    } finally {
      setSubmitting(false);
    }
  }

  async function reviewReport(reportId: string, action: "acknowledged" | "resolved") {
    const response = await fetch(`/api/abuse-reports/${encodeURIComponent(reportId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (!response.ok) {
      setError("Unable to update the safety report.");
      return;
    }
    await refreshReports();
  }

  const state = profile?.verificationState ?? "unverified";
  const highRisk = profile ? industryNeedsAdditionalReview(profile.industry) : false;
  const restrictedUntil = profile?.paymentLinksRestrictedUntil
    ? new Date(profile.paymentLinksRestrictedUntil)
    : null;

  return (
    <section id="trust-safety" className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#009966]" />
        <div>
          <h2 className="text-sm font-bold text-[#0D1B3D]">Business Verification &amp; Safety</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
            CollectBoss review is a platform safety check. It is not government or regulatory verification.
          </p>
        </div>
      </div>

      <div className="mt-3 rounded-xl bg-gray-50 p-3">
        <p className="text-[11px] text-gray-500">Verification state</p>
        <p className={`mt-1 text-sm font-bold ${state === "verified" ? "text-emerald-700" : state === "restricted" || state === "rejected" ? "text-red-700" : "text-amber-700"}`}>
          {verificationDisplayLabel(state)}
        </p>
        {profile?.verificationPublicNote && <p className="mt-1 text-xs text-gray-600">{profile.verificationPublicNote}</p>}
        {restrictedUntil && (
          <p className="mt-2 text-xs font-semibold text-red-700">
            Latest payment-link restriction runs until {restrictedUntil.toLocaleString("en-MY")}.
          </p>
        )}
      </div>

      {(state === "unverified" || state === "rejected") && (
        <form className="mt-3 space-y-2" onSubmit={requestVerification}>
          <input
            value={registrationReference}
            onChange={(event) => setRegistrationReference(event.target.value)}
            maxLength={500}
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs"
            placeholder="Registration document/reference (optional)"
          />
          <input
            value={licenceReference}
            onChange={(event) => setLicenceReference(event.target.value)}
            maxLength={500}
            required={profile?.industry === "financing_money_lending"}
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs"
            placeholder={highRisk ? "Licence reference for additional review" : "Licence reference (if applicable)"}
          />
          <textarea
            value={ownerNote}
            onChange={(event) => setOwnerNote(event.target.value)}
            maxLength={1000}
            rows={2}
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs"
            placeholder="Context for the reviewer (optional)"
          />
          {highRisk && <p className="text-[11px] text-amber-700">This industry requires additional review before sensitive payment-link features are enabled.</p>}
          <PrimaryButton fullWidth type="submit" disabled={submitting}>
            {submitting ? "Submitting…" : "Request CollectBoss review"}
          </PrimaryButton>
        </form>
      )}

      <div className="mt-5 border-t border-gray-100 pt-4">
        <h3 className="text-xs font-bold text-[#0D1B3D]">Payment-link safety reports</h3>
        {loading ? <p className="mt-2 text-xs text-gray-400">Loading reports…</p> : reports.length === 0 ? (
          <p className="mt-2 text-xs text-gray-500">No debtor safety reports have been received.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {reports.map((report) => (
              <article key={report.id} className="rounded-xl border border-amber-100 bg-amber-50 p-3">
                <div className="flex items-start gap-2">
                  {report.tenant_review_status === "resolved"
                    ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                    : <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-amber-950">{reasonLabels[report.category] ?? report.category}</p>
                    <p className="mt-0.5 text-[10px] text-amber-700">Case {report.case_id} · {new Date(report.created_at).toLocaleString("en-MY")}</p>
                    {report.details && <p className="mt-2 text-xs text-gray-700">{report.details}</p>}
                    {report.platform_review_required && <p className="mt-2 text-[10px] font-bold text-red-700">Escalated to CollectBoss platform safety review</p>}
                    <div className="mt-2 flex gap-2">
                      {report.tenant_review_status === "pending" && (
                        <button type="button" onClick={() => void reviewReport(report.id, "acknowledged")} className="text-[11px] font-bold text-amber-800 underline">Acknowledge</button>
                      )}
                      {report.tenant_review_status !== "resolved" && (
                        <button type="button" onClick={() => void reviewReport(report.id, "resolved")} className="text-[11px] font-bold text-emerald-700 underline">Mark resolved</button>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
    </section>
  );
}
