import { expect, test } from "@playwright/test";

test.describe("design-system visual states", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("authentication form at compact width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/signup");
    await expect(page.getByRole("heading", { name: "Create Account" })).toBeVisible();
    await expect(page).toHaveScreenshot("signup-compact.png", { animations: "disabled", fullPage: true });
  });

  test("public portal invalid-token error at desktop width", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/pay/not-a-capability-token");
    await expect(page.getByRole("heading", { name: "Invalid payment link" })).toBeVisible();
    await expect(page).toHaveScreenshot("public-payment-error-desktop.png", { animations: "disabled", fullPage: true });
  });
});
