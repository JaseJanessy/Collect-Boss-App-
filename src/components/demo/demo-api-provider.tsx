"use client";

import { useEffect } from "react";
import { demoApiResponse } from "@/lib/demo/demo-api";
import { isMockDataEnabled, isSupabaseConfigured } from "@/lib/supabase/client";

const DEMO_MODE = isMockDataEnabled && !isSupabaseConfigured;

/**
 * Development mock mode only: answers known dashboard reads with sample data
 * and refuses demo writes with a plain message. It never installs when
 * Supabase is configured, and mock mode is already blocked outside
 * development by the Supabase runtime guard.
 */
export function DemoApiProvider() {
  useEffect(() => {
    if (!DEMO_MODE) return;
    const originalFetch = window.fetch;
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const sameOrigin = url.startsWith("/") || url.startsWith(window.location.origin);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      const demo = sameOrigin ? demoApiResponse(url.replace(window.location.origin, ""), method) : undefined;
      if (!demo) return originalFetch(input, init);
      return new Response(JSON.stringify(demo.body), {
        status: demo.status,
        headers: { "Content-Type": "application/json", "X-CollectBoss-Demo": "1" },
      });
    };
    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return null;
}
