import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isServiceRequestError,
  requestBlob,
  requestJson,
} from "@/lib/data/http-service";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shared data-layer HTTP service", () => {
  it("returns typed JSON and adds a content type for JSON bodies", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestJson<{ ok: boolean }>("/api/example", {
      method: "POST",
      body: JSON.stringify({ value: 1 }),
    })).resolves.toEqual({ ok: true });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(request.headers).get("Content-Type")).toBe("application/json");
  });

  it("does not force a JSON content type for FormData", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const form = new FormData();
    form.set("file", new Blob(["proof"]), "proof.txt");

    await requestJson("/api/upload", { method: "POST", body: form });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(request.headers).has("Content-Type")).toBe(false);
  });

  it("preserves status, code, and response details on service errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "Review duplicate customers.",
      code: "DUPLICATE_REVIEW_REQUIRED",
      duplicates: [{ id: "customer-1" }],
    }), { status: 409, headers: { "Content-Type": "application/json" } })));

    try {
      await requestJson("/api/customers");
      throw new Error("Expected requestJson to reject.");
    } catch (error) {
      expect(isServiceRequestError(error)).toBe(true);
      if (!isServiceRequestError<{ duplicates: Array<{ id: string }> }>(error)) return;
      expect(error.status).toBe(409);
      expect(error.code).toBe("DUPLICATE_REVIEW_REQUIRED");
      expect(error.body.duplicates[0]?.id).toBe("customer-1");
    }
  });

  it("returns binary responses through the same transport boundary", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("invoice", { status: 200 })));
    const blob = await requestBlob("/api/invoice.pdf");
    await expect(blob.text()).resolves.toBe("invoice");
  });
});
