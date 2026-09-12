import { expect, test } from "@playwright/test";

// Isolated development fixtures verify presentation only, never live account access.
for (const viewport of [{ name: "phone", width: 390, height: 844 }, { name: "desktop", width: 1440, height: 1000 }]) {
  test(`corporate public and account layouts at ${viewport.name} size`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize(viewport);
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const path of ["/landing", "/login", "/signup?plan=boss", "/forgot-password", "/workspace-unavailable"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
      const name = path.split("?")[0].slice(1);
      await page.screenshot({ path: testInfo.outputPath(`${name}-${viewport.name}.png`), fullPage: true });
      expect(runtimeErrors).toEqual([]);
    }
  });
  test(`Main and Pocket shared layouts at ${viewport.name} size`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize(viewport);
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    await page.addInitScript(() => {
      sessionStorage.setItem("cb_mock_session", JSON.stringify({ id: "mock-user-001", email: "qa@example.test", name: "QA Business Owner" }));
      sessionStorage.setItem("cb_mock_business_complete", "1");
    });
    for (const path of ["/", "/cases", "/payments", "/more", "/pocket/more"]) {
      await page.goto(path);
      await expect(page.getByRole("main")).toBeVisible();
      await expect(page.getByRole("navigation", { name: path.startsWith("/pocket") ? "Pocket primary navigation" : "Primary navigation", exact: true })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
      if (path === "/more") await expect(page.getByRole("main").getByText("Pro Plan", { exact: true })).toHaveCount(0);
      if (path === "/cases") expect(await page.getByRole("textbox", { name: "Search cases", exact: true }).evaluate((field) => Number.parseFloat(getComputedStyle(field).paddingLeft))).toBeGreaterThanOrEqual(36);
      if (path === "/pocket/more") await expect(page.getByRole("main").getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`${path.replaceAll("/", "-") || "home"}-${viewport.name}.png`), fullPage: true });
      expect(runtimeErrors).toEqual([]);
    }
  });
}
