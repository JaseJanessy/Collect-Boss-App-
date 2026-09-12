import "server-only";

import { isMockDataEnabled, isSupabaseConfigured } from "@/lib/supabase/client";
import { requireTenantPermission } from "@/lib/auth/tenant-access";
import { loadPocketEntitlements } from "@/lib/billing/pocket-entitlements";
import type { WorkspaceContextResponse } from "../../../shared/workspace-contracts";

type WorkspaceAccess = Exclude<Awaited<ReturnType<typeof requireTenantPermission>>, { error: string; status: number }>;

export type WorkspaceContextResult =
  | { context: WorkspaceContextResponse }
  | { error: string; code: "AUTHENTICATION_REQUIRED" | "WORKSPACE_ACCESS_DENIED" | "WORKSPACE_CONTEXT_UNAVAILABLE"; status: 401 | 403 | 503 };

export async function resolveWorkspaceContextForAccess(access: WorkspaceAccess): Promise<WorkspaceContextResult> {
  const [productResult, subscriptionResult, entitlementResult] = await Promise.all([
    access.service.from("workspace_product_states")
      .select("product_type, lifecycle_state")
      .eq("business_id", access.businessId)
      .maybeSingle(),
    access.service.from("subscriptions")
      .select("plan_slug, status")
      .eq("business_id", access.businessId)
      .maybeSingle(),
    access.service.from("entitlements")
      .select("plan_slug")
      .eq("business_id", access.businessId)
      .maybeSingle(),
  ]);

  if (productResult.error || subscriptionResult.error || entitlementResult.error) {
    return {
      error: "Workspace context is temporarily unavailable.",
      code: "WORKSPACE_CONTEXT_UNAVAILABLE",
      status: 503,
    };
  }

  const productType = productResult.data?.product_type === "pocket" ? "pocket" : "main";
  let planSlug = entitlementResult.data?.plan_slug ?? subscriptionResult.data?.plan_slug ?? "free";
  let subscriptionStatus: string | null = subscriptionResult.data?.status ?? null;
  if (productType === "pocket") {
    const pocket = await loadPocketEntitlements(access);
    if ("error" in pocket) return { error: pocket.error, code: "WORKSPACE_CONTEXT_UNAVAILABLE", status: 503 };
    planSlug = pocket.entitlements.baseOffer ?? "pocket";
    subscriptionStatus = pocket.entitlements.lifecycleState;
  }
  const lifecycleState = productResult.data?.lifecycle_state === "grace_read_only"
    ? "grace_read_only"
    : productResult.data?.lifecycle_state === "suspended"
      ? "suspended"
      : "active";

  return {
    context: {
      workspace: {
        name: access.business.business_name,
        productType,
        lifecycleState,
      },
      plan: {
        slug: planSlug,
        subscriptionStatus,
      },
    },
  };
}

export async function requireWorkspaceContext(
  developmentProduct: "main" | "pocket" = "main",
): Promise<WorkspaceContextResult> {
  if (!isSupabaseConfigured && isMockDataEnabled) {
    return {
      context: {
        workspace: {
          name: "CollectBoss Demo",
          productType: developmentProduct,
          lifecycleState: "active",
        },
        plan: { slug: developmentProduct === "pocket" ? "pocket" : "free", subscriptionStatus: null },
      },
    };
  }

  const access = await requireTenantPermission("case.read");
  if ("error" in access) {
    return {
      error: access.status === 401 ? "You must be signed in." : "Workspace access is unavailable.",
      code: access.status === 401 ? "AUTHENTICATION_REQUIRED" : access.status === 403 ? "WORKSPACE_ACCESS_DENIED" : "WORKSPACE_CONTEXT_UNAVAILABLE",
      status: access.status as 401 | 403 | 503,
    };
  }
  return resolveWorkspaceContextForAccess(access);
}

/** Preserve the existing Main development experience when explicit mock mode is enabled. */
export async function workspaceContextForLanding(): Promise<WorkspaceContextResponse | null> {
  if (!isSupabaseConfigured && isMockDataEnabled) {
    return {
      workspace: { name: "CollectBoss Demo", productType: "main", lifecycleState: "active" },
      plan: { slug: "free", subscriptionStatus: null },
    };
  }
  const result = await requireWorkspaceContext();
  return "context" in result ? result.context : null;
}
