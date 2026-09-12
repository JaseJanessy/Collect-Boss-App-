import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured, type AppSupabaseClient } from "./client";

/** Session-aware Supabase client for Route Handlers and Server Components only. */
export async function getServerClient(): Promise<AppSupabaseClient | null> {
  if (!isSupabaseConfigured) return null;

  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot set response cookies.
        }
      },
    },
  });
}

/**
 * Avoid a network-backed auth lookup for public visitors who cannot have a
 * Supabase session. Supabase may split large session cookies into numbered
 * chunks, so accept both the base cookie and its `.0`, `.1`, ... variants.
 */
export async function hasServerAuthCookie(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore
    .getAll()
    .some(({ name }) => /^sb-.+-auth-token(?:\.\d+)?$/.test(name));
}
