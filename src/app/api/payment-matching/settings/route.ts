import { NextRequest } from "next/server";
import { appendSensitiveAudit } from "@/lib/auth/tenant-access";
import { requireTenantPermission } from "@/lib/auth/tenant-access";
import { matchingAccessError, matchingError, matchingJson } from "@/lib/payment-matching/api";
import { loadMatchingSettings } from "@/lib/payment-matching/server";
import { matchingSettingsSchema } from "@/lib/payment-matching/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await requireTenantPermission("payment.approve");
  if ("error" in access) return matchingAccessError(access);
  return matchingJson({ settings: await loadMatchingSettings(access), safeLimits: {
    highConfidence: [70, 95], ambiguous: [30, 69], dateWindowDays: [1, 30], maximumCandidates: [3, 20],
  } });
}

export async function PUT(request: NextRequest) {
  const access = await requireTenantPermission("payment.approve");
  if ("error" in access) return matchingAccessError(access);
  const parsed = matchingSettingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return matchingError("INVALID_MATCHING_SETTINGS", parsed.error.issues[0]?.message ?? "The matching thresholds are invalid.", 422);
  const before = await loadMatchingSettings(access);
  const { error } = await access.service.from("payment_matching_settings").upsert({
    business_id: access.businessId,
    high_confidence_threshold: parsed.data.highConfidence,
    ambiguous_threshold: parsed.data.ambiguous,
    date_window_days: parsed.data.dateWindowDays,
    maximum_candidates: parsed.data.maximumCandidates,
    updated_by: access.user.id,
    updated_at: new Date().toISOString(),
  }, { onConflict: "business_id" });
  if (error) return matchingError("SETTINGS_UPDATE_FAILED", "Unable to update matching thresholds.", 500);
  try {
    await appendSensitiveAudit({ access, request, action: "payment_matching.settings_updated", entityType: "payment_matching_settings",
      entityId: access.businessId, before: { ...before }, after: { ...parsed.data } });
  } catch {
    return matchingError("AUDIT_WRITE_FAILED", "Settings were saved, but the required audit record could not be written.", 500);
  }
  return matchingJson({ settings: parsed.data });
}
