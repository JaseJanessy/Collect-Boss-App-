import "server-only";

import { createHash } from "node:crypto";
import { getServiceClient } from "@/lib/supabase/service-client";
import type { IntegrationHealthRow, IntegrationJobRow, Json } from "@/lib/supabase/types";

export type IntegrationProvider = IntegrationJobRow["provider"];
export type IntegrationJobType = IntegrationJobRow["job_type"];

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function integrationJobKey(input: {
  provider: IntegrationProvider;
  jobType: IntegrationJobType;
  businessId: string | null;
  resourceId: string;
  operationKey: string;
}) {
  return digest([input.provider, input.jobType, input.businessId ?? "platform", input.resourceId, input.operationKey].join(":"));
}

export async function enqueueIntegrationJob(input: {
  provider: IntegrationProvider;
  jobType: IntegrationJobType;
  businessId: string | null;
  resourceId: string;
  operationKey: string;
  payload?: Record<string, Json | undefined>;
  createdBy?: string | null;
  maxAttempts?: number;
}) {
  const service = await getServiceClient();
  if (!service) throw new Error("Integration recovery queue is unavailable.");
  const cleanPayload = Object.fromEntries(Object.entries(input.payload ?? {}).filter((entry) => entry[1] !== undefined)) as Json;
  const { data, error } = await service.from("integration_jobs").upsert({
    business_id: input.businessId,
    provider: input.provider,
    job_type: input.jobType,
    resource_id: input.resourceId,
    deduplication_key: integrationJobKey(input),
    payload: cleanPayload,
    created_by: input.createdBy ?? null,
    max_attempts: Math.max(1, Math.min(input.maxAttempts ?? 8, 20)),
  }, { onConflict: "deduplication_key", ignoreDuplicates: true }).select("*").maybeSingle();
  if (error) throw new Error("Integration recovery operation could not be queued.");
  if (data) return data as IntegrationJobRow;
  const { data: existing, error: readError } = await service.from("integration_jobs").select("*")
    .eq("deduplication_key", integrationJobKey(input)).maybeSingle();
  if (readError || !existing) throw new Error("Integration recovery operation could not be confirmed.");
  return existing as IntegrationJobRow;
}

export async function claimIntegrationJobs(limit = 25) {
  const service = await getServiceClient();
  if (!service) throw new Error("Integration recovery queue is unavailable.");
  const { data, error } = await service.rpc("integration_claim_jobs", { p_limit: Math.max(1, Math.min(limit, 100)) });
  if (error) throw new Error("Integration recovery jobs could not be claimed.");
  return { service, jobs: (data ?? []) as IntegrationJobRow[] };
}

export async function finishIntegrationJob(input: {
  jobId: string;
  succeeded: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
}) {
  const service = await getServiceClient();
  if (!service) throw new Error("Integration recovery queue is unavailable.");
  const { data, error } = await service.rpc("integration_finish_job", {
    p_job_id: input.jobId,
    p_succeeded: input.succeeded,
    p_error_code: input.errorCode ?? null,
    p_error_message: input.errorMessage?.slice(0, 1000) ?? null,
  });
  if (error || !data) throw new Error("Integration recovery result could not be persisted.");
  return data as IntegrationJobRow;
}

export async function recordIntegrationHealth(input: {
  businessId: string;
  provider: IntegrationProvider;
  succeeded: boolean;
  errorCode?: string | null;
  actionableMessage?: string | null;
  actionRequired?: boolean;
  metadata?: Record<string, Json | undefined>;
}) {
  const service = await getServiceClient();
  if (!service) throw new Error("Integration health store is unavailable.");
  const { data: current } = await service.from("integration_health").select("consecutive_failures,last_success_at")
    .eq("business_id", input.businessId).eq("provider", input.provider).maybeSingle();
  const now = new Date().toISOString();
  const failures = input.succeeded ? 0 : Number(current?.consecutive_failures ?? 0) + 1;
  const status: IntegrationHealthRow["status"] = input.succeeded
    ? "healthy"
    : input.actionRequired ? "action_required" : failures >= 5 ? "outage" : "degraded";
  const metadata = Object.fromEntries(Object.entries(input.metadata ?? {}).filter((entry) => entry[1] !== undefined)) as Json;
  const { error } = await service.from("integration_health").upsert({
    business_id: input.businessId,
    provider: input.provider,
    status,
    last_checked_at: now,
    last_success_at: input.succeeded ? now : current?.last_success_at ?? null,
    last_failure_at: input.succeeded ? null : now,
    consecutive_failures: failures,
    error_code: input.succeeded ? null : input.errorCode?.slice(0, 100) ?? "INTEGRATION_FAILURE",
    actionable_message: input.succeeded ? null : input.actionableMessage?.slice(0, 500) ?? "The provider operation failed and will be retried.",
    metadata,
    updated_at: now,
  }, { onConflict: "business_id,provider" });
  if (error) throw new Error("Integration health could not be updated.");
}

export function safeIntegrationError(error: unknown) {
  const message = error instanceof Error ? error.message : "Integration operation failed.";
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(?:access|refresh)[_-]?token[=:]\s*\S+/gi, "token=[redacted]")
    .slice(0, 1000);
}
