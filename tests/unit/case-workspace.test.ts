import { describe, expect, it } from "vitest";
import {
  canAccessCaseWorkspaceSection,
  caseWorkspaceHref,
  caseWorkspaceSections,
  resolveCaseWorkspaceSection,
} from "@/lib/cases/workspace";

describe("case workspace routing and permissions", () => {
  it("creates canonical shareable section URLs", () => {
    expect(caseWorkspaceHref("CB 1", "overview")).toBe("/cases/CB%201");
    expect(caseWorkspaceHref("CB 1", "evidence")).toBe("/cases/CB%201?section=evidence");
  });

  it("rejects unknown sections and supports historical tab URLs", () => {
    expect(resolveCaseWorkspaceSection("unknown", null)).toBe("overview");
    expect(resolveCaseWorkspaceSection(null, "payments")).toBe("financials");
    expect(resolveCaseWorkspaceSection(null, "documents")).toBe("legal");
    expect(resolveCaseWorkspaceSection(null, "timeline")).toBe("activity");
  });

  it("uses any-of semantics for mixed resolution responsibilities", () => {
    const resolution = caseWorkspaceSections.find((section) => section.id === "resolution")!;
    expect(canAccessCaseWorkspaceSection(resolution, ["promise.manage"])).toBe(true);
    expect(canAccessCaseWorkspaceSection(resolution, ["dispute.resolve"])).toBe(true);
    expect(canAccessCaseWorkspaceSection(resolution, ["case.read"])).toBe(false);
  });
});
