import "server-only";

import type { PostgrestError } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

import { requireMobilePermission } from "@/lib/auth/mobile-access";
import { requireTenantPermission } from "@/lib/auth/tenant-access";
import type { AppSupabaseClient } from "@/lib/supabase/client";
import type { TenantPermission } from "@/lib/auth/permissions";
import {
  stablePocketBillingError,
  type PocketBillingErrorCode,
  type PocketCapabilityKey,
  type PocketLifecycleState,
} from "./pocket-policy";

export interface PocketCapabilityView {
  enabled: boolean;
  limit: number | null;
  used: number | null;
  remaining: number | null;
}

export interface PocketEntitlementView {
  productType: "pocket";
  baseOffer: "pocket_monthly" | "pocket_annual" | null;
  lifecycleState: PocketLifecycleState;
  readOnly: boolean;
  billingCycle: { startsAt: string | null; endsAt: string | null };
  addOns: { simpleInvoice: boolean; extraInvoicePack: boolean };
  capabilities: Record<PocketCapabilityKey, PocketCapabilityView>;
}

export type PocketBillingAccessError = {
  error: string;
  code: PocketBillingErrorCode;
  status: 402 | 403 | 409 | 503;
};

type PocketServiceAccess = {
  service: AppSupabaseClient;
  businessId: string;
  user: { id: string };
};

export async function requirePocketBillingAccess(permission: TenantPermission = "case.read") {
  const access = await requireTenantPermission(permission);
  if ("error" in access) {
    return { error: "Pocket access is unavailable.", code: "PLAN_NOT_AUTHORISED", status: access.status === 503 ? 503 : 403 } as PocketBillingAccessError;
  }
  const { data, error } = await access.service.from("workspace_product_states")
    .select("product_type")
    .eq("business_id", access.businessId)
    .maybeSingle();
  if (error) return { error: "Pocket access is temporarily unavailable.", code: "PLAN_NOT_AUTHORISED", status: 503 } as PocketBillingAccessError;
  if (data?.product_type !== "pocket") return { error: "This action is not available for this product.", code: "PLAN_NOT_AUTHORISED", status: 403 } as PocketBillingAccessError;
  return access;
}

export async function requirePocketMobileBillingAccess(request: NextRequest, permission: TenantPermission = "case.read") {
  const access = await requireMobilePermission(request, permission);
  if ("error" in access) return { error: "Pocket access is unavailable.", code: "PLAN_NOT_AUTHORISED", status: access.status === 503 ? 503 : 403 } as PocketBillingAccessError;
  const { data, error } = await access.service.from("workspace_product_states")
    .select("product_type").eq("business_id", access.businessId).maybeSingle();
  if (error) return { error: "Pocket access is temporarily unavailable.", code: "PLAN_NOT_AUTHORISED", status: 503 } as PocketBillingAccessError;
  if (data?.product_type !== "pocket") return { error: "This action is not available for this product.", code: "PLAN_NOT_AUTHORISED", status: 403 } as PocketBillingAccessError;
  return access;
}

function entitlementShape(value: unknown): PocketEntitlementView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.productType !== "pocket" || typeof record.lifecycleState !== "string" || !record.capabilities || typeof record.capabilities !== "object") return null;
  return record as unknown as PocketEntitlementView;
}

export async function loadPocketEntitlements(
  access: PocketServiceAccess,
): Promise<{ entitlements: PocketEntitlementView } | PocketBillingAccessError> {
  const { data, error } = await access.service.rpc("pocket_get_entitlements", { p_business_id: access.businessId });
  if (error) return pocketDatabaseError(error, "Pocket plan information is temporarily unavailable.");
  const entitlements = entitlementShape(data);
  if (!entitlements) return { error: "Pocket plan information is temporarily unavailable.", code: "PLAN_NOT_AUTHORISED", status: 503 };
  return { entitlements };
}

export async function authorizePocketCapability(params: {
  access: PocketServiceAccess;
  capability: PocketCapabilityKey;
  operationKey?: string | null;
  consume?: boolean;
}) {
  const { data, error } = await params.access.service.rpc("pocket_authorize_capability", {
    p_business_id: params.access.businessId,
    p_actor_id: params.access.user.id,
    p_capability_key: params.capability,
    p_operation_key: params.operationKey ?? null,
    p_consume: params.consume ?? false,
  });
  if (error) return pocketDatabaseError(error, "This Pocket action is unavailable.");
  return { authorization: data as Record<string, unknown> };
}

function pocketDatabaseError(error: Pick<PostgrestError, "message">, fallback: string): PocketBillingAccessError {
  const stableCode = stablePocketBillingError(error.message);
  if (!stableCode) return { error: fallback, code: "PLAN_NOT_AUTHORISED", status: 503 };
  const code = stableCode;
  const status = code === "LIMIT_REACHED" || code === "ADD_ON_REQUIRED" ? 409
    : code === "SUBSCRIPTION_PAST_DUE" ? 402
      : code === "READ_ONLY_MODE" || code === "PLAN_NOT_AUTHORISED" ? 403
        : 503;
  return { error: fallback, code, status };
}
