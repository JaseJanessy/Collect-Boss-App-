import { requestJson } from "@/lib/data/http-service";
import type { RegionSettings } from "@/lib/international/types";
import type { ReportMetrics } from "@/lib/reports/metrics";

export interface DashboardSummaryPayload {
  metrics: ReportMetrics;
}

export interface ReportsSummaryPayload extends DashboardSummaryPayload {
  generatedAt: string;
  region: RegionSettings;
  reconciliation: {
    checkedCases: number;
    driftedCases: number;
  };
}

export function loadDashboardSummary(): Promise<DashboardSummaryPayload> {
  return requestJson<DashboardSummaryPayload>(
    "/api/dashboard/summary",
    { cache: "no-store" },
    "Unable to load dashboard.",
  );
}

export function loadReportsSummary(): Promise<ReportsSummaryPayload> {
  return requestJson<ReportsSummaryPayload>(
    "/api/reports/summary",
    { cache: "no-store" },
    "Unable to load reports.",
  );
}
