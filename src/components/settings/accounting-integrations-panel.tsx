"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Eye, Link2, RefreshCw, Unplug } from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import type { AccountingProvider, PublicAccountingConnection } from "@/lib/accounting/types";
import { useRegion } from "@/contexts/region-context";
import { formatDateTime } from "@/lib/international/formatting";
import type { RegionSettings } from "@/lib/international/types";

interface SyncRun {
  id: string;
  connection_id: string;
  provider: AccountingProvider;
  mode: "full" | "incremental" | "preview";
  status: "running" | "preview_ready" | "succeeded" | "failed";
  counts: Record<string, number>;
  preview: unknown[];
  errors: Array<{ code?: string; message?: string }>;
  started_at: string;
  finished_at: string | null;
}

interface IntegrationResponse {
  connections: PublicAccountingConnection[];
  runs: SyncRun[];
  health: Array<{ provider: AccountingProvider; status: "unknown" | "healthy" | "degraded" | "action_required" | "outage" | "disconnected"; last_checked_at: string | null; actionable_message: string | null; consecutive_failures: number }>;
  jobs: Array<{ id: string; provider: AccountingProvider; job_type: string; status: "retry_scheduled" | "dead_letter"; attempts: number; max_attempts: number; next_attempt_at: string; last_error_message: string | null }>;
}

const PROVIDERS: Array<{ id: AccountingProvider; name: string; description: string }> = [
  { id: "xero", name: "Xero", description: "Contacts, sales invoices, payments and allocated credit notes." },
  { id: "quickbooks", name: "QuickBooks Online", description: "Customers, invoices, payments and credit memos." },
];

function dateLabel(value: string | null, settings: RegionSettings) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : formatDateTime(date, settings);
}

export function AccountingIntegrationsPanel() {
  const { configuration } = useRegion();
  const [data, setData] = useState<IntegrationResponse>({ connections: [], runs: [], health: [], jobs: [] });
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/integrations/accounting", { cache: "no-store" });
    const payload = await response.json().catch(() => null) as (IntegrationResponse & { error?: string }) | null;
    if (!response.ok || !payload) throw new Error(payload?.error ?? "Unable to load accounting integrations.");
    setData(payload);
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      load().catch((error: unknown) => {
        if (active) setMessage({ tone: "error", text: error instanceof Error ? error.message : "Unable to load integrations." });
      }).finally(() => { if (active) setLoading(false); });
      const query = new URLSearchParams(window.location.search);
      if (active && query.get("accounting") === "connected") setMessage({ tone: "success", text: "Accounting provider connected. Preview the first import before syncing." });
      if (active && query.get("accounting") === "error") setMessage({ tone: "error", text: query.get("message") ?? "Accounting authorization failed." });
    });
    return () => { active = false; };
  }, [load]);

  const connections = useMemo(() => new Map(data.connections.map((connection) => [connection.provider, connection])), [data.connections]);

  async function sync(provider: AccountingProvider, mode: "preview" | "incremental") {
    setWorking(`${provider}:${mode}`);
    setMessage(null);
    try {
      const response = await fetch(`/api/integrations/accounting/${provider}/sync`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }),
      });
      const payload = await response.json().catch(() => null) as { error?: string; counts?: Record<string, number> } | null;
      if (!response.ok) throw new Error(payload?.error ?? "Accounting sync failed.");
      const total = Object.values(payload?.counts ?? {}).reduce((sum, count) => sum + count, 0);
      setMessage({
        tone: "success",
        text: mode === "preview" ? `Preview ready: ${total} records inspected. Review the summary below, then sync when ready.` : `Sync completed: ${total} records reconciled.`,
      });
      await load();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Accounting sync failed." });
      await load().catch(() => undefined);
    } finally { setWorking(null); }
  }

  async function disconnect(connection: PublicAccountingConnection) {
    if (!window.confirm(`Disconnect ${connection.organizationName ?? connection.provider}? Imported history and mappings will be preserved.`)) return;
    setWorking(`${connection.provider}:disconnect`);
    setMessage(null);
    try {
      const response = await fetch("/api/integrations/accounting", {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ connectionId: connection.id }),
      });
      const payload = await response.json().catch(() => null) as { error?: string; warning?: string | null } | null;
      if (!response.ok) throw new Error(payload?.error ?? "Unable to disconnect the provider.");
      setMessage({ tone: payload?.warning ? "error" : "success", text: payload?.warning ?? "Integration disconnected. Imported history was preserved." });
      await load();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Unable to disconnect the provider." });
    } finally { setWorking(null); }
  }

  async function replay(jobId: string) {
    const reason = window.prompt("Why is this integration job safe to replay?", "Provider configuration reviewed; retry the idempotent operation.");
    if (!reason) return;
    setWorking(`replay:${jobId}`);
    try {
      const response = await fetch(`/api/integrations/jobs/${jobId}/replay`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }),
      });
      const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(payload?.error?.message ?? "Integration replay could not be queued.");
      setMessage({ tone: "success", text: "The idempotent operation was queued for replay." });
      await load();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Integration replay could not be queued." });
    } finally { setWorking(null); }
  }

  return (
    <div id="integrations" className="scroll-mt-20">
      <SectionCard title="Accounting Integrations">
        <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
          Optional read-only sync. Your accounting platform remains the source of truth for financial records;
          CollectBoss keeps recovery actions, promises, disputes and notes. Event notifications are reconciled with scheduled polling, not promised as real-time.
        </p>
        {message && (
          <div className={`mt-3 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[11px] ${message.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>
            {message.tone === "success" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
            <span>{message.text}</span>
          </div>
        )}
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {PROVIDERS.map((provider) => {
            const connection = connections.get(provider.id);
            const connected = connection?.status === "connected" || connection?.status === "error";
            const latestRun = data.runs.find((run) => run.provider === provider.id);
            const health = data.health.find((item) => item.provider === provider.id);
            const failedJobs = data.jobs.filter((job) => job.provider === provider.id);
            return (
              <div key={provider.id} className="rounded-2xl border border-gray-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-900">{provider.name}</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{provider.description}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-wide ${connection?.status === "connected" ? "bg-emerald-100 text-emerald-700" : connection?.status === "error" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-500"}`}>
                    {connection?.status ?? "Not connected"}
                  </span>
                </div>
                {loading ? (
                  <p className="mt-4 text-xs text-gray-400">Loading connection…</p>
                ) : connected && connection ? (
                  <div className="mt-4 space-y-3">
                    <div className="rounded-xl bg-gray-50 px-3 py-2.5 text-[11px]">
                      <p className="font-semibold text-gray-800">{connection.organizationName ?? "Connected organization"}</p>
                      <p className="mt-1 text-gray-500">Last successful sync: {dateLabel(connection.lastSuccessfulSyncAt, configuration.settings)}</p>
                      <p className="mt-0.5 text-gray-400">Scopes: {connection.scopes.join(", ") || "Provider accounting access"}</p>
                      <p className={`mt-1 font-semibold ${health?.status === "healthy" ? "text-emerald-700" : health?.status === "action_required" || health?.status === "outage" ? "text-red-700" : "text-amber-700"}`}>
                        Operational health: {health?.status?.replace("_", " ") ?? "unknown"}
                      </p>
                      {health?.actionable_message && <p className="mt-0.5 text-gray-600">{health.actionable_message}</p>}
                    </div>
                    {connection.lastError && (
                      <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-[11px] text-red-700">{connection.lastError}</div>
                    )}
                    {latestRun && (
                      <div className="rounded-xl border border-gray-100 px-3 py-2 text-[10px] text-gray-500">
                        <p className="font-semibold text-gray-700">Latest {latestRun.mode.replace("_", " ")} · {latestRun.status.replace("_", " ")}</p>
                        <p className="mt-1">{Object.entries(latestRun.counts ?? {}).map(([key, value]) => `${key.replace("_", " ")}: ${value}`).join(" · ") || "No records returned"}</p>
                        {latestRun.preview?.length > 0 && <p className="mt-1 text-emerald-700">Preview sample retained for {latestRun.preview.length} records.</p>}
                        {latestRun.errors?.map((error, index) => <p key={`${error.code}-${index}`} className="mt-1 text-red-700">{error.message ?? error.code ?? "Sync error"}</p>)}
                      </div>
                    )}
                    {failedJobs.map((job) => (
                      <div key={job.id} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] text-amber-900">
                        <p className="font-bold">{job.status === "dead_letter" ? "Manual review required" : "Automatic retry scheduled"} · attempt {job.attempts}/{job.max_attempts}</p>
                        {job.last_error_message && <p className="mt-1">{job.last_error_message}</p>}
                        <button type="button" onClick={() => replay(job.id)} disabled={working !== null} className="mt-2 rounded-lg border border-amber-300 bg-white px-2 py-1 font-bold disabled:opacity-50">
                          {working === `replay:${job.id}` ? "Queueing…" : "Replay safely"}
                        </button>
                      </div>
                    ))}
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <button onClick={() => sync(provider.id, "preview")} disabled={working !== null} className="flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                        <Eye className="h-3.5 w-3.5" /> {working === `${provider.id}:preview` ? "Previewing…" : "Preview"}
                      </button>
                      <button onClick={() => sync(provider.id, "incremental")} disabled={working !== null} className="flex items-center justify-center gap-1.5 rounded-xl bg-[#009966] px-3 py-2 text-[11px] font-bold text-white hover:bg-[#00B377] disabled:opacity-50">
                        <RefreshCw className={`h-3.5 w-3.5 ${working === `${provider.id}:incremental` ? "animate-spin" : ""}`} /> Sync now
                      </button>
                      <button onClick={() => disconnect(connection)} disabled={working !== null} className="flex items-center justify-center gap-1.5 rounded-xl border border-red-100 px-3 py-2 text-[11px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
                        <Unplug className="h-3.5 w-3.5" /> Disconnect
                      </button>
                    </div>
                  </div>
                ) : (
                  <a href={`/api/integrations/accounting/${provider.id}/connect`} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#0D1B3D] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#162956]">
                    <Link2 className="h-4 w-4" /> Connect {provider.name}
                  </a>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[10px] leading-relaxed text-gray-400">
          Disconnecting removes local OAuth credentials but never deletes imported customers, invoices, payments, credit links, cases or recovery history.
        </p>
      </SectionCard>
    </div>
  );
}
