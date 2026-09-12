import { describe, expect, it } from "vitest";
import { roleHasPermission } from "@/lib/auth/permissions";

const locked = {
  manager_can_approve_settlements: false,
  manager_can_approve_write_offs: false,
  manager_can_submit_document_intakes: false,
};

describe("tenant role matrix", () => {
  it("keeps sensitive account actions with owners and admins", () => {
    for (const permission of ["billing.manage", "users.manage", "receiving_accounts.manage", "export.run"] as const) {
      expect(roleHasPermission("owner", permission, locked)).toBe(true);
      expect(roleHasPermission("admin", permission, locked)).toBe(true);
      expect(roleHasPermission("manager", permission, locked)).toBe(false);
    }
  });
  it("lets staff follow up but never manage cases or financial approvals", () => {
    expect(roleHasPermission("staff", "communication.manage", locked)).toBe(true);
    expect(roleHasPermission("staff", "promise.manage", locked)).toBe(true);
    expect(roleHasPermission("staff", "case.manage", locked)).toBe(false);
    expect(roleHasPermission("staff", "payment.approve", locked)).toBe(false);
  });
  it("keeps viewers read-only and manager settlement/write-off approval configurable", () => {
    expect(roleHasPermission("viewer", "case.read", locked)).toBe(true);
    expect(roleHasPermission("viewer", "note.manage", locked)).toBe(false);
    expect(roleHasPermission("manager", "settlement.approve", locked)).toBe(false);
    expect(roleHasPermission("manager", "write_off.approve", {
      manager_can_approve_settlements: true,
      manager_can_approve_write_offs: true,
      manager_can_submit_document_intakes: false,
    })).toBe(true);
  });
});
