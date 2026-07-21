import { expect, test } from "@playwright/test";

test("PWA manifest has install icons and private APIs remain non-cacheable", async ({ page, request }) => {
  const manifestResponse = await request.get("/manifest.json");
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = await manifestResponse.json() as { display: string; icons: Array<{ src: string; sizes: string }> };
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ src: "/icons/icon-192.png", sizes: "192x192" }),
    expect.objectContaining({ src: "/icons/icon-512.png", sizes: "512x512" }),
  ]));

  for (const iconPath of ["/icons/icon-192.png", "/icons/icon-512.png"]) {
    const iconResponse = await request.get(iconPath);
    expect(iconResponse.ok(), iconPath).toBeTruthy();
    expect(iconResponse.headers()["content-type"]).toContain("image/png");
  }

  const apiResponse = await request.get("/api/dashboard/summary");
  expect(apiResponse.headers()["cache-control"]).toContain("no-store");

  await page.goto("/landing");
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.getRegistrations().then((registrations) => registrations.length))).toBe(0);
});
