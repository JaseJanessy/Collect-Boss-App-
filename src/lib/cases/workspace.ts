import type { TenantPermission } from "@/lib/auth/permissions";

export const caseWorkspaceSectionIds = [
  "overview",
  "financials",
  "communications",
  "resolution",
  "evidence",
  "legal",
  "activity",
] as const;

export type CaseWorkspaceSectionId = (typeof caseWorkspaceSectionIds)[number];

export interface CaseWorkspaceSection {
  id: CaseWorkspaceSectionId;
  label: string;
  permissions: readonly TenantPermission[];
  legacyTabs: readonly string[];
}

export const caseWorkspaceSections: readonly CaseWorkspaceSection[] = [
  { id: "overview", label: "Overview", permissions: ["case.read"], legacyTabs: ["overview"] },
  { id: "financials", label: "Financials", permissions: ["payment.approve"], legacyTabs: ["payments"] },
  { id: "communications", label: "Communications", permissions: ["communication.manage"], legacyTabs: [] },
  { id: "resolution", label: "Resolution", permissions: ["promise.manage", "dispute.resolve"], legacyTabs: [] },
  { id: "evidence", label: "Evidence", permissions: ["case.manage"], legacyTabs: [] },
  { id: "legal", label: "Legal", permissions: ["case.manage"], legacyTabs: ["documents"] },
  { id: "activity", label: "Activity", permissions: ["case.read"], legacyTabs: ["timeline"] },
] as const;

export function isCaseWorkspaceSection(value: string | null | undefined): value is CaseWorkspaceSectionId {
  return caseWorkspaceSectionIds.includes(value as CaseWorkspaceSectionId);
}

export function resolveCaseWorkspaceSection(section: string | null | undefined, legacyTab?: string | null): CaseWorkspaceSectionId {
  if (isCaseWorkspaceSection(section)) return section;
  const legacyOwner = caseWorkspaceSections.find((item) => item.legacyTabs.includes(legacyTab ?? ""));
  return legacyOwner?.id ?? "overview";
}

export function canAccessCaseWorkspaceSection(
  section: Pick<CaseWorkspaceSection, "permissions">,
  permissions: readonly TenantPermission[],
): boolean {
  return section.permissions.some((permission) => permissions.includes(permission));
}

export function caseWorkspaceHref(caseId: string, section: CaseWorkspaceSectionId): string {
  const base = `/cases/${encodeURIComponent(caseId)}`;
  return section === "overview" ? base : `${base}?section=${section}`;
}
