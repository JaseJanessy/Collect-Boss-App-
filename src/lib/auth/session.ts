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
    const user = mockSignIn(email, password);
    return { success: true, requiresProfile: false };
  }

  const client = getBrowserClient();
  if (!client) return { success: false, error: "Auth unavailable" };

  const { error } = await client.auth.signInWithPassword({ email, password });

  if (error) {
    if (error.message.includes("Invalid login credentials")) {
      return { success: false, error: "Incorrect email or password. Please try again." };
    }
    if (error.message.includes("Email not confirmed")) {
      return { success: false, error: "Please verify your email address first." };
    }
    return { success: false, error: error.message };
  }

  return { success: true };
}

// ─── Sign up ──────────────────────────────────────────────────────────────────

export async function signUp(
  email: string,
  password: string,
  name?: string
): Promise<SignUpResult> {
  if (!isSupabaseConfigured) {
    mockSignUp(email, password);
    return { success: true, needsConfirmation: false };
  }

  const client = getBrowserClient();
  if (!client) return { success: false, error: "Auth unavailable" };

  const { error } = await client.auth.signUp({
    email,
    password,
    options: {
      data: { name: name ?? "" },
      emailRedirectTo: `${window.location.origin}/auth/callback`,
    },
  });

  if (error) {
    if (error.message.includes("already registered")) {
      return { success: false, error: "This email is already registered. Try logging in." };
    }
    return { success: false, error: error.message };
  }

  return { success: true, needsConfirmation: true };
}

// ─── Sign out ─────────────────────────────────────────────────────────────────

export async function signOut(): Promise<void> {
  if (!isSupabaseConfigured) {
    clearMockSession();
    window.location.href = "/login";
    return;
  }

  const client = getBrowserClient();
  if (!client) return;

  await client.auth.signOut();
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
    redirectTo: `${window.location.origin}/reset-password`,
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
