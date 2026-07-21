import { expect, test, type Page } from "@playwright/test";

const responsiveViewports = [
  { name: "phone portrait", width: 390, height: 844 },
  { name: "phone landscape", width: 844, height: 390 },
  { name: "tablet portrait", width: 768, height: 1024 },
  { name: "tablet landscape", width: 1024, height: 768 },
  { name: "desktop", width: 1440, height: 900 },
];

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
}

test("landing page exposes landmarks and a keyboard-operable phone menu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/landing");

  await expect(page.getByRole("heading", { name: "Collect overdue payments professionally." })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("main")).toHaveAttribute("id", "landing-main-content");

  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await skipLink.focus();
  await expect(skipLink).toBeVisible();

  const menuButton = page.getByRole("button", { name: "Toggle menu" });
  await menuButton.press("Enter");
  await expect(page.locator('#landing-mobile-nav a[href="#features"]')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("signup form has associated labels and reports validation errors", async ({ page }) => {
  await page.goto("/signup");

  await expect(page.getByLabel("Your Full Name")).toBeVisible();
  await expect(page.getByLabel("Email Address")).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create Account" }).click();

  const nameInput = page.getByLabel("Your Full Name");
  await expect(nameInput).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Your name is required.")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("public capability routes reject malformed tokens without revealing case data", async ({ page }) => {
  await page.goto("/pay/not-a-capability-token");
  await expect(page.getByRole("heading", { name: "Invalid payment link" })).toBeVisible();
  await expect(page.getByText("This link cannot be used. Please check the link or contact the creditor.")).toBeVisible();

  await page.goto("/acknowledge/not-a-capability-token");
  await expect(page.getByRole("heading", { name: "Invalid acknowledgement link" })).toBeVisible();
});

test("landing page stays within every supported viewport", async ({ page }) => {
  for (const viewport of responsiveViewports) {
    await test.step(viewport.name, async () => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/landing");
      await expect(page.getByRole("heading", { name: "Collect overdue payments professionally." })).toBeVisible({ timeout: 20_000 });
      await expectNoHorizontalOverflow(page);
    });
  }
});
