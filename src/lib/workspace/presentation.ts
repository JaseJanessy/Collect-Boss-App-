/** Display only. Authorization must always use server-side entitlements. */
export function workspacePlanLabel(slug?: string | null): string {
  if (!slug) return "Plan unavailable";
  const labels: Record<string, string> = {
    free: "Free", starter: "Starter", boss: "Boss", pro: "Pro", solo: "Solo",
    pocket: "Pocket", pocket_monthly: "Pocket · Monthly", pocket_annual: "Pocket · Annual",
  };
  return labels[slug] ?? "Workspace plan";
}
