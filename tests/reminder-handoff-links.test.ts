import assert from "node:assert/strict";
import test from "node:test";
import { buildEmailLink, buildWhatsAppLink } from "../src/lib/reminders/handoff-links.ts";

test("WhatsApp handoff normalizes Malaysian phone numbers and URL-encodes long content", () => {
  const message = `Amount due & reference #1\n${"x".repeat(4000)}`;
  const url = new URL(buildWhatsAppLink("012-345 6789", message));
  assert.equal(url.hostname, "wa.me");
  assert.equal(url.pathname, "/60123456789");
  assert.equal(url.searchParams.get("text"), message);
});

test("email handoff URL-encodes all composer fields and handles a missing recipient", () => {
  const url = new URL(buildEmailLink("debtor@example.com", "Invoice & overdue", "Please pay RM 10.00\nThank you"));
  assert.equal(url.protocol, "mailto:");
  assert.equal(decodeURIComponent(url.pathname), "debtor@example.com");
  assert.equal(url.searchParams.get("subject"), "Invoice & overdue");
  assert.equal(url.searchParams.get("body"), "Please pay RM 10.00\nThank you");
  assert.equal(buildEmailLink(null, "Subject", "Body"), "");
});
