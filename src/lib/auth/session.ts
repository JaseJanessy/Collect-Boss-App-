/**
 * Auth session helpers — wraps Supabase Auth with mock fallback.
 * All functions check isSupabaseConfigured before calling Supabase.
 */

import { isSupabaseConfigured, getBrowserClient } from "@/lib/supabase/client";
import {
  getMockUser,
  mockSignIn,
  mockSignUp,
  clearMockSession,
} from "./mock-session";
import {
  type AuthUser,
  type SignInResult,
  type SignUpResult,
  type ResetPasswordResult,
} from "./types";
import { readUserRegistration } from "@collectboss/registration-contracts";
import type { PlanSlug } from "@/lib/billing/types";

async function provisionRegistrationSession(
  accessToken: string,
  user: { app_metadata?: unknown; user_metadata?: unknown },
): Promise<string | null> {
  if (!readUserRegistration(user)) return null;

  try {
    const response = await fetch("/api/workspace/provision", {
      method: "POST",
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    return response.ok ? null : payload?.error ?? "Unable to prepare your CollectBoss workspace.";
  } catch {
    return "Unable to reach the secure CollectBoss workspace service.";
  }
}

async function requiresProductSelection(accessToken: string): Promise<boolean> {
    const response = await fetch("/api/workspace/context", {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok) return false;
    const payload = await response.json().catch(() => null) as { code?: string } | null;
    if (response.status === 403 && payload?.code === "WORKSPACE_ACCESS_DENIED") return true;
    throw new Error("You are signed in, but your workspace could not be opened. Please retry or check System Status.");
}

// ─── Get current user ─────────────────────────────────────────────────────────

export function getCurrentUser(): AuthUser | null {
  if (!isSupabaseConfigured) return getMockUser();

  // For client components — use the cached session
  const client = getBrowserClient();
  if (!client) return null; // Supabase configured but unavailable → unauthenticated

  // Note: getSession() is async; this sync version returns null if not cached.
  // The AuthProvider handles the async resolution.
  return null;
}

export async function getCurrentUserAsync(): Promise<AuthUser | null> {
  if (!isSupabaseConfigured) return getMockUser();

  const client = getBrowserClient();
  if (!client) return null; // Supabase configured but unavailable → unauthenticated

  const { data: { user } } = await client.auth.getUser();
  if (!user) return null;

  return {
    id:    user.id,
    email: user.email ?? "",
    name:  user.user_metadata?.name as string | undefined,
  };
}

// ─── Sign in ──────────────────────────────────────────────────────────────────

export async function signIn(
  email: string,
  password: string
): Promise<SignInResult> {
  if (!isSupabaseConfigured) {
    mockSignIn(email, password);
    return { success: true, requiresProfile: false };
  }

  const client = getBrowserClient();
  if (!client) return { success: false, error: "Auth unavailable" };

  const { data, error } = await client.auth.signInWithPassword({ email, password });

  if (error) {
    if (error.message.includes("Invalid login credentials")) {
      return { success: false, error: "Incorrect email or password. Please try again." };
    }
    if (error.message.includes("Email not confirmed")) {
      return { success: false, error: "Please verify your email address first." };
    }
    return { success: false, error: error.message };
  }

  if (!data.session) return { success: false, error: "The sign-in service did not establish a session. Please try again." };
  if (data.session) {
    const provisioningError = await provisionRegistrationSession(
      data.session.access_token,
      data.user,
    );
    if (provisioningError) return { success: false, error: provisioningError };
    try {
      const needsProduct = await requiresProductSelection(data.session.access_token);
      if (needsProduct) return { success: true, requiresProductSelection: true };
    } catch {
      return { success: false, error: "Your login was accepted, but workspace access is temporarily unavailable. Please retry or contact support." };
    }
  }

  return { success: true };
}

// ─── Sign up ──────────────────────────────────────────────────────────────────

export async function signUp(
  email: string,
  password: string,
  selectedPlan?: PlanSlug,
  preferredProduct?: "pocket",
): Promise<SignUpResult> {
  if (!isSupabaseConfigured) {
    mockSignUp(email, password);
    return { success: true, needsConfirmation: false };
  }

  const client = getBrowserClient();
  if (!client) return { success: false, error: "Auth unavailable" };

  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(
        selectedPlan ? `/choose-product?plan=${selectedPlan}` : preferredProduct ? `/choose-product?product=${preferredProduct}` : "/choose-product",
      )}`,
    },
  });

  if (error) {
    if (error.message.includes("already registered")) {
      return { success: false, error: "This email is already registered. Try logging in." };
    }
    return { success: false, error: error.message };
  }

  return { success: true, needsConfirmation: !data.session };
}

// ─── Sign out ─────────────────────────────────────────────────────────────────

export async function signOut(): Promise<void> {
  if (!isSupabaseConfigured) {
    clearMockSession();
    window.location.href = "/login";
    return;
  }

  const client = getBrowserClient();
  if (!client) throw new Error("Sign-out service is unavailable. Please retry.");

  const { error } = await client.auth.signOut();
  if (error) throw new Error("We could not complete sign out. Please retry before leaving this device.");
  window.location.href = "/login";
}

// ─── Reset password ───────────────────────────────────────────────────────────

export async function requestPasswordReset(
  email: string
): Promise<ResetPasswordResult> {
  if (!isSupabaseConfigured) {
    // Mock: pretend we sent an email
    return { success: true };
  }

  const client = getBrowserClient();
  if (!client) return { success: false, error: "Auth unavailable" };

  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/auth/callback?next=%2Freset-password`,
  });

  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function updatePassword(
  newPassword: string
): Promise<ResetPasswordResult> {
  if (!isSupabaseConfigured) {
    return { success: true };
  }

  const client = getBrowserClient();
  if (!client) return { success: false, error: "Auth unavailable" };

  const { error } = await client.auth.updateUser({ password: newPassword });
  if (error) return { success: false, error: error.message };
  return { success: true };
}

// ─── Auth state change listener ───────────────────────────────────────────────

export function onAuthStateChange(
  callback: (user: AuthUser | null) => void
): () => void {
  if (!isSupabaseConfigured) {
    // Fire immediately with mock user
    callback(getMockUser());
    return () => {};
  }

  const client = getBrowserClient();
  if (!client) {
    callback(null);
    return () => {};
  }

  const { data: { subscription } } = client.auth.onAuthStateChange(
    (_event, session) => {
      if (!session?.user) {
        callback(null);
        return;
      }
      callback({
        id:    session.user.id,
        email: session.user.email ?? "",
        name:  session.user.user_metadata?.name as string | undefined,
      });
    }
  );

  return () => subscription.unsubscribe();
}
