"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, FileCheck2, Loader2 } from "lucide-react";
import { requestJson } from "@/lib/data/http-service";

export interface EinvoiceStatus {
  id: string;
  obligationId: string;
  status: "submitted" | "valid" | "invalid" | "cancelled" | "rejected";
  errors: string[];
  validationUrl: string | null;
  cancellable: boolean;
}

/** Loads the latest e-Invoice status for a set of invoices. */
export function useEinvoiceStatuses(obligationIds: string[]) {
  const key = obligationIds.join(",");
  const [statuses, setStatuses] = useState<Map<string, EinvoiceStatus>>(new Map());
  const load = useCallback(async () => {
    if (!key) return;
    try {
      const payload = await requestJson<{ documents: EinvoiceStatus[] }>(`/api/einvoice/documents?obligationIds=${encodeURIComponent(key)}`, { cache: "no-store" });
      setStatuses(new Map(payload.documents.map((item) => [item.obligationId, item])));
    } catch {
      // e-Invoice status is optional; the invoice list still works.
    }
  }, [key]);
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);
  return { statuses, reload: load };
}

const LABEL: Record<EinvoiceStatus["status"], string> = {
  submitted: "e-Invoice: checking with LHDN",
  valid: "e-Invoice validated",
  invalid: "e-Invoice rejected by LHDN",
  rejected: "e-Invoice not accepted",
  cancelled: "e-Invoice cancelled",
};

/** Send / view / cancel the LHDN e-Invoice for one invoice. */
export function EinvoiceActions({ obligationId, status, onChanged }: { obligationId: string; status?: EinvoiceStatus; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string[]>([]);

  async function send() {
    setBusy(true);
    setError([]);
    try {
      await requestJson("/api/einvoice/documents", { method: "POST", body: JSON.stringify({ obligationId }) }, "We couldn't send the e-Invoice.");
      onChanged();
    } catch (cause) {
      const body = (cause as { body?: { problems?: string[] } }).body;
      setError(body?.problems?.length ? body.problems : [cause instanceof Error ? cause.message : "We couldn't send the e-Invoice."]);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!status) return;
    const reason = window.prompt("Why are you cancelling this e-Invoice? (LHDN records the reason)");
    if (!reason?.trim()) return;
    setBusy(true);
    setError([]);
    try {
      await requestJson(`/api/einvoice/documents/${encodeURIComponent(status.id)}/cancel`, { method: "POST", body: JSON.stringify({ reason }) }, "We couldn't cancel the e-Invoice.");
      onChanged();
    } catch (cause) {
      setError([cause instanceof Error ? cause.message : "We couldn't cancel the e-Invoice."]);
    } finally {
      setBusy(false);
    }
  }

  const canSend = !status || ["invalid", "rejected", "cancelled"].includes(status.status);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px]">
      {status && (
        <span className={`inline-flex items-center gap-1 font-bold ${status.status === "valid" ? "text-emerald-700" : status.status === "submitted" ? "text-blue-700" : "text-red-700"}`}>
          <FileCheck2 className="h-3 w-3" aria-hidden="true" />{LABEL[status.status]}
        </span>
      )}
      {status?.validationUrl && (
        <a href={status.validationUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-bold text-[#087F5B]">
          LHDN link <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      )}
      {canSend && (
        <button type="button" disabled={busy} onClick={() => void send()} className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-gray-200 px-2 font-bold text-gray-700 disabled:opacity-50">
          {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}{status ? "Send e-Invoice again" : "Send e-Invoice"}
        </button>
      )}
      {status?.cancellable && (
        <button type="button" disabled={busy} onClick={() => void cancel()} className="min-h-8 rounded-lg px-2 font-bold text-red-700 disabled:opacity-50">Cancel e-Invoice</button>
      )}
      {(error.length > 0 || (status && status.errors.length > 0 && canSend)) && (
        <ul role="alert" className="w-full list-disc pl-4 text-red-700">
          {(error.length ? error : status!.errors).slice(0, 5).map((item) => <li key={item}>{item}</li>)}
        </ul>
      )}
    </div>
  );
}
