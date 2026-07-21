"use client";

import { useEffect, useState } from "react";
import type { ReportMetrics } from "@/lib/reports/metrics";

export function useReportSummary() {
  const [metrics, setMetrics] = useState<ReportMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dashboard/summary", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ metrics: ReportMetrics }> : null)
      .then((payload) => { if (!cancelled) setMetrics(payload?.metrics ?? null); })
      .catch(() => { if (!cancelled) setMetrics(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { metrics, loading };
}
