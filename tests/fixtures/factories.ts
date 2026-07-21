import { vi } from "vitest";

export const FIXED_NOW = new Date("2026-01-15T09:30:00.000Z");

export const testIds = {
  business: "00000000-0000-4000-8000-000000000001",
  owner: "00000000-0000-4000-8000-000000000002",
  debtor: "00000000-0000-4000-8000-000000000003",
  case: "00000000-0000-4000-8000-000000000004",
} as const;

export function createTestBusiness(overrides: Partial<{ id: string; ownerId: string; name: string }> = {}) {
  return {
    id: testIds.business,
    ownerId: testIds.owner,
    name: "Test Business",
    ...overrides,
  };
}

export function useFixedClock(date = FIXED_NOW): void {
  vi.useFakeTimers();
  vi.setSystemTime(date);
}
