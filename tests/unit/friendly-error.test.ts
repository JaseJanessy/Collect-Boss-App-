import { describe, expect, it } from "vitest";
import {
  FRIENDLY_RATE_LIMIT_MESSAGE,
  FRIENDLY_RETRY_MESSAGE,
  FRIENDLY_SESSION_MESSAGE,
  friendlyErrorMessage,
} from "@/lib/ui/friendly-error";

describe("friendlyErrorMessage", () => {
  it.each([
    "Tenant access service is unavailable.",
    "Supabase client unavailable",
    "Workspace membership service is unavailable.",
    "Payment access service is unavailable.",
    "Pocket billing state store unavailable",
    "Public application URL is not configured correctly on this server.",
    "Failed to fetch",
  ])("replaces infrastructure wording: %s", (message) => {
    expect(friendlyErrorMessage(message)).toBe(FRIENDLY_RETRY_MESSAGE);
  });

  it.each([
    "The selected debt is unavailable.",
    "Incorrect email or password. Please try again.",
    "Archived cases cannot accept new evidence.",
    "You do not have permission to perform this action.",
  ])("keeps business messages: %s", (message) => {
    expect(friendlyErrorMessage(message)).toBe(message);
  });

  it("uses status-specific wording and fallbacks", () => {
    expect(friendlyErrorMessage("JWT expired", { status: 401 })).toBe(FRIENDLY_SESSION_MESSAGE);
    expect(friendlyErrorMessage(undefined, { status: 429 })).toBe(FRIENDLY_RATE_LIMIT_MESSAGE);
    expect(friendlyErrorMessage("", { fallback: "Export failed." })).toBe("Export failed.");
    expect(friendlyErrorMessage(null)).toBe(FRIENDLY_RETRY_MESSAGE);
  });
});
