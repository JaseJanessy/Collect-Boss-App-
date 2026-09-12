export type CollectBossProductType = "main" | "pocket";

export type WorkspaceLifecycleState = "active" | "grace_read_only" | "suspended";

export interface WorkspaceContextResponse {
  workspace: {
    name: string;
    productType: CollectBossProductType;
    lifecycleState: WorkspaceLifecycleState;
  };
  plan: {
    slug: string;
    subscriptionStatus: string | null;
  };
}

export type WorkspaceContextErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "WORKSPACE_ACCESS_DENIED"
  | "WORKSPACE_CONTEXT_UNAVAILABLE";

export interface WorkspaceContextErrorResponse {
  error: string;
  code: WorkspaceContextErrorCode;
}

export function productHomePath(productType: CollectBossProductType): "/" | "/pocket" {
  return productType === "pocket" ? "/pocket" : "/";
}

export function productOwnsProtectedPath(productType: CollectBossProductType, pathname: string): boolean {
  const isPocketPath = pathname === "/pocket" || pathname.startsWith("/pocket/");
  return productType === "pocket" ? isPocketPath : !isPocketPath;
}
