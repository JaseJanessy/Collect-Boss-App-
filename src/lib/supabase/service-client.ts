import "server-only";

import { createClient } from "@supabase/supabase-js";
import {
  SUPABASE_URL,
  isDeploymentEnvironment,
  isSupabaseConfigured,
  type AppSupabaseClient,
} from "./client";

/** Privileged Supabase client for trusted server-side operations only. */
export async function getServiceClient(): Promise<AppSupabaseClient | null> {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!isSupabaseConfigured) return null;
  if (!serviceKey) {
    if (isDeploymentEnvironment) {
      throw new Error("[CollectBoss] Blocking configuration error: SUPABASE_SERVICE_ROLE_KEY is required for server-only privileged operations.");
    }
    return null;
  }

  return createClient(SUPABASE_URL, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
