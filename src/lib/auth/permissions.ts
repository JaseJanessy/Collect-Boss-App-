export const tenantRoles = ["owner", "admin", "manager", "staff", "viewer"] as const;
export type TenantRole = typeof tenantRoles[number];

export const tenantPermissions = [
  "billing.manage", "users.manage", "receiving_accounts.manage", "export.run",
  "settings.sensitive.manage", "case.read", "case.manage", "payment.approve", "payment.reallocation.approve",
  "settlement.approve", "write_off.approve", "report.read", "communication.manage",
  "note.manage", "promise.manage", "audit.read", "dispute.resolve",
  "document_intake.read", "document_intake.create", "document_intake.submit", "public_link.manage",
  "compliance.policy.manage", "compliance.approve.agent", "compliance.approve.supervisor",
  "compliance.approve.legal", "compliance.bypass",
] as const;
export type TenantPermission = typeof tenantPermissions[number];

export interface RoleSettings {
  manager_can_approve_settlements: boolean;
  manager_can_approve_write_offs: boolean;
  manager_can_submit_document_intakes: boolean;
}

const adminPermissions = new Set<TenantPermission>(tenantPermissions);
const managerPermissions = new Set<TenantPermission>([
  "case.read", "case.manage", "payment.approve", "report.read", "communication.manage",
  "note.manage", "promise.manage", "audit.read", "dispute.resolve",
  "document_intake.read", "document_intake.create",
  "compliance.approve.agent", "compliance.approve.supervisor",
]);
const staffPermissions = new Set<TenantPermission>([
  "case.read", "communication.manage", "note.manage", "promise.manage",
  "document_intake.read", "document_intake.create",
  "compliance.approve.agent",
]);
const viewerPermissions = new Set<TenantPermission>(["case.read", "report.read", "document_intake.read"]);

export function roleHasPermission(role: TenantRole, permission: TenantPermission, settings: RoleSettings): boolean {
  if (role === "owner" || role === "admin") return adminPermissions.has(permission);
  if (role === "manager") {
    if (permission === "settlement.approve") return settings.manager_can_approve_settlements;
    if (permission === "write_off.approve") return settings.manager_can_approve_write_offs;
    if (permission === "document_intake.submit") return settings.manager_can_submit_document_intakes;
    return managerPermissions.has(permission);
  }
  if (role === "staff") return staffPermissions.has(permission);
  return viewerPermissions.has(permission);
}
