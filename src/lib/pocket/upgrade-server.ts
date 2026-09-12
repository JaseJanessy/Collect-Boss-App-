import "server-only";

import { requestDigest } from "@/lib/document-intake/validation";
import type { Json, PocketSoloUpgradeItemRow, PocketSoloUpgradeRunRow } from "@/lib/supabase/types";
import { getServiceClient } from "@/lib/supabase/service-client";
import type { AppSupabaseClient } from "@/lib/supabase/client";

type OwnerAccess = {
  businessId: string;
  user: { id: string };
  role: string;
  service: AppSupabaseClient;
};

export type PocketSoloUpgradeView = {
  run: Pick<PocketSoloUpgradeRunRow,
    "id" | "status" | "target_plan_slug" | "source_counts" | "reconciliation"
    | "pocket_subscription_cleanup_status" | "last_error_code" | "started_at" | "completed_at"> | null;
  reviewItems: Array<Pick<PocketSoloUpgradeItemRow,
    "id" | "obligation_id" | "disposition" | "status" | "review_reason" | "target_case_id" | "source_snapshot">>;
  downgradeSupported: false;
  targetProduct: "CollectBoss Solo";
  internalPlanSlug: "starter";
};

export class PocketSoloUpgradeError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
  }
}

function databaseCode(message: string) {
  return [
    "POCKET_UPGRADE_OWNER_REQUIRED", "POCKET_UPGRADE_SINGLE_USER_REQUIRED",
    "POCKET_UPGRADE_SOURCE_NOT_POCKET", "POCKET_UPGRADE_IDEMPOTENCY_CONFLICT",
    "POCKET_UPGRADE_ALREADY_COMPLETED", "POCKET_UPGRADE_REVIEW_REQUIRED",
    "POCKET_UPGRADE_SOURCE_CHANGED", "POCKET_UPGRADE_FINANCIAL_MISMATCH",
  ].find((code) => message.includes(code)) ?? "POCKET_UPGRADE_UNAVAILABLE";
}

function stableError(error: { message?: string } | null, fallback: string): never {
  const code = databaseCode(error?.message ?? "");
  const status = code === "POCKET_UPGRADE_OWNER_REQUIRED" ? 403
    : code === "POCKET_UPGRADE_SOURCE_NOT_POCKET" || code === "POCKET_UPGRADE_ALREADY_COMPLETED" ? 409
      : code === "POCKET_UPGRADE_SINGLE_USER_REQUIRED" || code === "POCKET_UPGRADE_REVIEW_REQUIRED"
        || code === "POCKET_UPGRADE_SOURCE_CHANGED" || code === "POCKET_UPGRADE_IDEMPOTENCY_CONFLICT" ? 409
        : 503;
  throw new PocketSoloUpgradeError(fallback, code, status);
}

export function assertPocketUpgradeOwner(access: OwnerAccess) {
  if (access.role !== "owner") {
    throw new PocketSoloUpgradeError("Only the workspace owner can upgrade to Solo.", "POCKET_UPGRADE_OWNER_REQUIRED", 403);
  }
}

export async function loadPocketSoloUpgrade(access: OwnerAccess): Promise<PocketSoloUpgradeView> {
  assertPocketUpgradeOwner(access);
  const runResult = await access.service.from("pocket_solo_upgrade_runs")
    .select("id,status,target_plan_slug,source_counts,reconciliation,pocket_subscription_cleanup_status,last_error_code,started_at,completed_at")
    .eq("business_id", access.businessId).order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (runResult.error) stableError(runResult.error, "Upgrade status is temporarily unavailable.");
  const run = runResult.data;
  const itemResult = run ? await access.service.from("pocket_solo_upgrade_items")
    .select("id,obligation_id,disposition,status,review_reason,target_case_id,source_snapshot")
    .eq("business_id", access.businessId).eq("run_id", run.id)
    .in("status", ["review_required", "preserve_only"]).order("created_at", { ascending: true })
    : { data: [], error: null };
  if (itemResult.error) stableError(itemResult.error, "Upgrade review items are temporarily unavailable.");
  return {
    run: run as PocketSoloUpgradeView["run"],
    reviewItems: (itemResult.data ?? []) as PocketSoloUpgradeView["reviewItems"],
    downgradeSupported: false,
    targetProduct: "CollectBoss Solo",
    internalPlanSlug: "starter",
  };
}

export async function preparePocketSoloUpgrade(access: OwnerAccess, idempotencyKey: string) {
  assertPocketUpgradeOwner(access);
  const requestHash = requestDigest({
    action: "pocket_to_solo_upgrade",
    businessId: access.businessId,
    actorId: access.user.id,
    targetPlanSlug: "starter",
  });
  const { data, error } = await access.service.rpc("pocket_prepare_solo_upgrade", {
    p_business_id: access.businessId,
    p_actor_id: access.user.id,
    p_idempotency_key: idempotencyKey,
    p_request_hash: requestHash,
  });
  if (error || !data) stableError(error, "Pocket could not prepare the Solo upgrade.");
  return data as Json;
}

export async function attachPocketSoloCheckout(input: {
  access: OwnerAccess;
  runId: string;
  checkoutSessionId: string;
}) {
  const { access } = input;
  assertPocketUpgradeOwner(access);
  const { error } = await access.service.rpc("pocket_attach_solo_upgrade_checkout", {
    p_business_id: access.businessId,
    p_actor_id: access.user.id,
    p_run_id: input.runId,
    p_checkout_session_id: input.checkoutSessionId,
  });
  if (error) stableError(error, "Pocket could not attach the Solo checkout.");
}

export async function commitPocketSoloUpgrade(input: {
  businessId: string;
  runId: string;
  actorId: string;
  providerEventId: string;
}) {
  const service = await getServiceClient();
  if (!service) throw new Error("Pocket Solo upgrade store unavailable");
  const { data, error } = await service.rpc("pocket_commit_solo_upgrade", {
    p_business_id: input.businessId,
    p_run_id: input.runId,
    p_actor_id: input.actorId,
    p_provider_event_id: input.providerEventId,
  });
  if (error || !data) throw new Error(`Pocket Solo upgrade commit failed: ${databaseCode(error?.message ?? "")}`);
  return data as Record<string, Json | undefined>;
}

export async function markPocketSoloCleanup(input: {
  businessId: string;
  runId: string;
  status: "completed" | "failed";
  errorCode?: string | null;
}) {
  const service = await getServiceClient();
  if (!service) throw new Error("Pocket Solo upgrade store unavailable");
  const { error } = await service.rpc("pocket_mark_solo_upgrade_cleanup", {
    p_business_id: input.businessId,
    p_run_id: input.runId,
    p_status: input.status,
    p_error_code: input.errorCode ?? null,
  });
  if (error) throw new Error("Pocket Solo billing cleanup status could not be recorded");
}
