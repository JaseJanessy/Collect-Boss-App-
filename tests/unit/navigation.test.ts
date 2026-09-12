import { describe, expect, it } from "vitest";
import { roleHasPermission, tenantPermissions, type TenantRole } from "@/lib/auth/permissions";
import {
  navigationItemIsVisible,
  primaryNavigation,
  requiredPermissionForPath,
  secondaryNavigation,
} from "@collectboss/navigation";

const settings = {
  manager_can_approve_settlements: false,
  manager_can_approve_write_offs: false,
  manager_can_submit_document_intakes: false,
};

function permissionsFor(role: TenantRole) {
  return tenantPermissions.filter((permission) => roleHasPermission(role, permission, settings));
}

describe("permission-aware navigation", () => {
  it("shows all five primary destinations to owners, admins and viewers", () => {
    for (const role of ["owner", "admin", "viewer"] as const) {
      const visible = primaryNavigation.filter((item) => navigationItemIsVisible(item, permissionsFor(role)));
      expect(visible.map((item) => item.label)).toEqual(["Dashboard", "Cases", "Payments", "Action Centre", "Reports"]);
    }
  });

  it("keeps Reports hidden from staff who lack report access", () => {
    const visible = primaryNavigation.filter((item) => navigationItemIsVisible(item, permissionsFor("staff")));
    expect(visible.map((item) => item.label)).toEqual(["Dashboard", "Cases", "Payments", "Action Centre"]);
  });

  it("hides privileged secondary destinations from managers and staff", () => {
    for (const role of ["manager", "staff"] as const) {
      const visible = secondaryNavigation
        .filter((item) => navigationItemIsVisible(item, permissionsFor(role)))
        .map((item) => item.id);
      expect(visible).not.toContain("billing");
      expect(visible).not.toContain("team");
      expect(visible).not.toContain("integrations");
      expect(visible).not.toContain("payment-accounts");
    }
  });

  it("maps direct URLs to the same permissions used by their menu items", () => {
    expect(requiredPermissionForPath("/billing/success")).toBe("billing.manage");
    expect(requiredPermissionForPath("/payments/account")).toBe("receiving_accounts.manage");
    expect(requiredPermissionForPath("/operations")).toBe("case.manage");
    expect(requiredPermissionForPath("/reports")).toBe("report.read");
    expect(requiredPermissionForPath("/cases/CB-1")).toBeUndefined();
  });
});
