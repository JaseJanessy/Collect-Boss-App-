"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { type AuthUser } from "@/lib/auth/types";
import { onAuthStateChange, signOut as endSession } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import type { WorkspaceContextResponse } from "../../shared/workspace-contracts";
import {
  tenantPermissions,
  type TenantPermission,
  type TenantRole,
} from "@/lib/auth/permissions";

// ─── Context shape ────────────────────────────────────────────────────────────

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  initializationError: string | null;
  accessLoading: boolean;
  accessError: string | null;
  workspace: WorkspaceContextResponse | null;
  role: TenantRole | null;
  permissions: TenantPermission[];
  hasPermission: (permission: TenantPermission) => boolean;
  isConfigured: boolean;
  signOut: () => Promise<void>;
  signOutError: string | null;
  signingOut: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  user:         null,
  loading:      true,
  initializationError: null,
  accessLoading: true,
  accessError: null,
  workspace: null,
  role:         null,
  permissions:  [],
  hasPermission: () => false,
  isConfigured: false,
  signOut:      async () => {},
  signOutError: null,
  signingOut: false,
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [remoteAccess, setRemoteAccess] = useState<{
    userId: string;
    role: TenantRole | null;
    permissions: TenantPermission[];
    workspace: WorkspaceContextResponse | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    let receivedInitialState = false;
    const timeout = window.setTimeout(() => {
      if (receivedInitialState) return;
      setInitializationError("CollectBoss could not verify your session. Please retry.");
      setLoading(false);
    }, 8_000);

    // Subscribe to auth state changes (normally fires immediately with current state).
    const unsubscribe = onAuthStateChange((authUser) => {
      receivedInitialState = true;
      window.clearTimeout(timeout);
      setUser(authUser);
      setInitializationError(null);
      setLoading(false);
    });

    return () => {
      window.clearTimeout(timeout);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;

    if (!user || !isSupabaseConfigured) return () => { active = false; };

    const userId = user.id;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    void Promise.all([
      fetch("/api/navigation", { cache: "no-store", signal: controller.signal }),
      fetch("/api/workspace/context", { cache: "no-store", signal: controller.signal }),
    ])
      .then(async ([response, workspaceResponse]) => {
        const payload = await response.json().catch(() => ({})) as {
          role?: TenantRole;
          permissions?: TenantPermission[];
        };
        if (!active) return;
        const workspace = await workspaceResponse.json().catch(() => null) as WorkspaceContextResponse | null;
        if (!active) return;
        if (!response.ok || !payload.role || !Array.isArray(payload.permissions) || !workspaceResponse.ok || !workspace?.workspace || !workspace?.plan) throw new Error("Workspace access could not be verified.");
        setRemoteAccess({
          userId,
          role: payload.role,
          permissions: payload.permissions.filter((permission) => tenantPermissions.includes(permission)),
          workspace,
          error: null,
        });
      })
      .catch(() => {
        if (!active) return;
        setRemoteAccess({ userId, role: null, permissions: [], workspace: null, error: "Workspace access could not be verified. Please retry or contact support." });
      }).finally(() => window.clearTimeout(timeout));

    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [user]);

  const role: TenantRole | null = !user
    ? null
    : isSupabaseConfigured
      ? remoteAccess && remoteAccess.userId === user.id ? remoteAccess.role : null
      : "owner";
  const permissions: TenantPermission[] = !user
    ? []
    : isSupabaseConfigured
      ? remoteAccess && remoteAccess.userId === user.id ? remoteAccess.permissions : []
      : [...tenantPermissions];
  const accessLoading = Boolean(user && isSupabaseConfigured && remoteAccess?.userId !== user.id);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        initializationError,
        accessLoading,
        accessError: user && remoteAccess && remoteAccess.userId === user.id ? remoteAccess.error : null,
        workspace: user && remoteAccess && remoteAccess.userId === user.id ? remoteAccess.workspace : null,
        role,
        permissions,
        hasPermission: (permission) => permissions.includes(permission),
        isConfigured: isSupabaseConfigured,
        signOutError,
        signingOut,
        signOut: async () => {
          if (signingOut) return;
          setSigningOut(true);
          setSignOutError(null);
          try { await endSession(); }
          catch { setSignOutError("Sign out did not complete. Please retry before leaving this device."); }
          finally { setSigningOut(false); }
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}
