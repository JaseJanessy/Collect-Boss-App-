// ─── Auth types ───────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
}

export interface AuthSession {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
}

export interface SignInResult {
  success: boolean;
  error?: string;
  requiresProfile?: boolean;
}

export interface SignUpResult {
  success: boolean;
  error?: string;
  /** Supabase sends a confirmation email — user must verify before logging in */
  needsConfirmation?: boolean;
}

export interface ResetPasswordResult {
  success: boolean;
  error?: string;
}
