/**
 * Mock session — used when NEXT_PUBLIC_SUPABASE_URL is not configured.
 * Stores session in sessionStorage so it resets on tab close.
 * Allows full UI testing without a real Supabase project.
 */

import { type AuthUser } from "./types";

const MOCK_SESSION_KEY = "cb_mock_session";
const MOCK_BUSINESS_KEY = "cb_mock_business_complete";

const MOCK_USER: AuthUser = {
  id: "mock-user-001",
  email: "demo@collectboss.my",
  name: "Amin Razali",
};

export function getMockUser(): AuthUser | null {
  if (typeof window === "undefined") return MOCK_USER; // SSR: treat as logged in
  const raw = sessionStorage.getItem(MOCK_SESSION_KEY);
  return raw ? (JSON.parse(raw) as AuthUser) : null;
}

export function setMockSession(user: AuthUser): void {
  if (typeof window !== "undefined") {
    sessionStorage.setItem(MOCK_SESSION_KEY, JSON.stringify(user));
  }
}

export function clearMockSession(): void {
  if (typeof window !== "undefined") {
    sessionStorage.removeItem(MOCK_SESSION_KEY);
    sessionStorage.removeItem(MOCK_BUSINESS_KEY);
  }
}

export function mockSignIn(email: string, _password: string): AuthUser {
  const user: AuthUser = { id: "mock-user-001", email, name: "Demo User" };
  setMockSession(user);
  return user;
}

export function mockSignUp(email: string, _password: string): AuthUser {
  const user: AuthUser = { id: "mock-user-001", email, name: "Demo User" };
  setMockSession(user);
  return user;
}

export function isMockBusinessComplete(): boolean {
  if (typeof window === "undefined") return true; // SSR: assume complete
  return sessionStorage.getItem(MOCK_BUSINESS_KEY) === "1";
}

export function setMockBusinessComplete(): void {
  if (typeof window !== "undefined") {
    sessionStorage.setItem(MOCK_BUSINESS_KEY, "1");
  }
}
