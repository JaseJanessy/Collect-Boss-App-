import { describe, expect, it } from "vitest";
import { createTestBusiness, FIXED_NOW, testIds, useFixedClock } from "../fixtures/factories";

describe("isolated test environment", () => {
  it("uses deterministic fixtures and cannot inherit deployment access", () => {
    useFixedClock();
    expect(new Date()).toEqual(FIXED_NOW);
    expect(createTestBusiness()).toMatchObject({ id: testIds.business, ownerId: testIds.owner });
    expect(process.env.NEXT_PUBLIC_APP_ENV).toBe("development");
    expect(process.env.NEXT_PUBLIC_ENABLE_MOCK_DATA).toBe("true");
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBeUndefined();
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(process.env.STRIPE_SECRET_KEY).toBeUndefined();
  });
});
