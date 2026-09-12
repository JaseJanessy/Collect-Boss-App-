"use client";

import { useEffect, useState } from "react";
import type { ReportMetrics } from "@/lib/reports/metrics";
import { loadDashboardSummary } from "@/lib/reports/client-service";

export function useReportSummary() {
  const [metrics, setMetrics] = useState<ReportMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadDashboardSummary()
      .then((payload) => { if (!cancelled) setMetrics(payload?.metrics ?? null); })
      .catch(() => { if (!cancelled) setMetrics(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reload]);

  return { metrics, loading, refresh: () => setReload((value) => value + 1) };
}
