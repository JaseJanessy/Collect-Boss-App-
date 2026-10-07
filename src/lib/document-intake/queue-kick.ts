import "server-only";

import { after } from "next/server";
import { getServiceClient } from "@/lib/supabase/service-client";
import { processEvidenceScanQueue } from "./scanning/worker";
import { processExtractionQueue } from "./extraction/worker";

/**
 * Starts malware scanning and extraction right after the response is sent,
 * instead of waiting for the next scheduled cron run. Uploads therefore stay
 * fast even when the crons run only daily (Vercel Hobby). Workers claim jobs
 * with FOR UPDATE SKIP LOCKED, so this is safe alongside the cron and other
 * kicks; any failure is left for the cron to retry.
 */
export function kickDocumentQueues() {
  after(async () => {
    const service = await getServiceClient();
    if (!service) return;
    try { await processEvidenceScanQueue(service); } catch { /* cron retries */ }
    try { await processExtractionQueue(service); } catch { /* cron retries */ }
  });
}
