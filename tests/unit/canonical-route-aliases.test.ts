import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("canonical route aliases", () => {
  it("connects dashboard to the existing root dashboard", () => {
    expect(source("src/app/dashboard/page.tsx")).toContain('permanentRedirect("/")');
  });

  it("connects customers to the existing customer page", () => {
    expect(source("src/app/customers/page.tsx")).toContain('permanentRedirect("/debtors")');
  });
});
