// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GlobalSearch } from "@/components/operations/global-search";

afterEach(() => vi.unstubAllGlobals());
describe("operational search states", () => {
  it("announces loading and network failure, not an empty result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<GlobalSearch />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "invoice" } });
    expect(screen.getByRole("status").textContent).toContain("Searching");
    expect(screen.queryByText("No matching records.")).toBeNull();
    await screen.findByRole("alert");
    expect(screen.queryByText("No matching records.")).toBeNull();
  });
  it("supports Escape and labelled keyboard-reachable results", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [{ result_type: "case", result_id: "qa", label: "QA invoice", href: "/cases/qa", subtitle: "Test only" }] }))));
    render(<GlobalSearch />);
    const search = screen.getByRole("searchbox");
    fireEvent.change(search, { target: { value: "invoice" } });
    await screen.findByRole("link", { name: /QA invoice/ });
    expect(search.getAttribute("aria-controls")).toBe(screen.getByRole("region", { name: "Search results" }).id);
    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Search results" })).toBeNull();
  });
  it("discards an old request after the query is cleared", async () => {
    let complete!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { complete = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<GlobalSearch />);
    const search = screen.getByRole("searchbox");
    fireEvent.change(search, { target: { value: "invoice" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.change(search, { target: { value: "" } });
    complete(new Response(JSON.stringify({ results: [{ result_type: "case", result_id: "stale", label: "Stale result", href: "/cases/stale" }] })));
    await waitFor(() => expect(screen.queryByText("Stale result")).toBeNull());
    expect(screen.queryByRole("region")).toBeNull();
  });
});
