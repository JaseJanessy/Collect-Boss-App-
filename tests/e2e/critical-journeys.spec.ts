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

async function installAuthenticatedMockSession(page: Page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("cb_mock_session", JSON.stringify({ id: "mock-user-001", name: "QA Business Owner", email: "qa@example.test" }));
    window.sessionStorage.setItem("cb_mock_business_complete", "1");
  });
}

test("landing page exposes landmarks and a keyboard-operable phone menu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/landing");

  await expect(page.getByRole("heading", { name: /Collect overdue payments.*With confidence/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("main")).toHaveAttribute("id", "landing-main-content");

  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await skipLink.focus();
  await expect(skipLink).toBeVisible();

  const menuButton = page.getByRole("button", { name: "Toggle menu" });
  await menuButton.press("Enter");
  await expect(page.locator('#landing-mobile-nav a[href="#features"]')).toBeVisible();
  await expect(page.locator('footer a', { hasText: "How It Works" })).toHaveAttribute("href", "#how");
  await expectNoHorizontalOverflow(page);
});

test("signup form has associated labels and reports validation errors", async ({ page }) => {
  await page.goto("/signup");

  await expect(page.getByLabel("Email Address")).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Confirm Password")).toBeVisible();
  await page.getByRole("button", { name: "Create Account and Continue" }).click();

  await expect(page.getByLabel("Email Address")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Confirm Password")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Email address is required.")).toBeVisible();
  await expect(page.getByText("Password is required.")).toBeVisible();
  await expect(page.getByText("Please confirm your password.")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("public capability routes reject malformed tokens without revealing case data", async ({ page }) => {
  test.setTimeout(60_000);
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
      await expect(page.getByRole("heading", { name: /Collect overdue payments.*With confidence/ })).toBeVisible({ timeout: 20_000 });
      await expectNoHorizontalOverflow(page);
    });
  }
});

test("authenticated primary navigation is consistent at every supported viewport", async ({ page }) => {
  test.setTimeout(120_000);
  await installAuthenticatedMockSession(page);
  const expectedItems = ["Dashboard", "Cases", "Payments", "Action Centre", "Reports"];

  for (const viewport of responsiveViewports) {
    await test.step(viewport.name, async () => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/");

      const primaryNavigation = page.getByRole("navigation", { name: "Primary navigation" });
      await expect(primaryNavigation).toBeVisible({ timeout: 20_000 });
      await expect(primaryNavigation.getByRole("link")).toHaveCount(expectedItems.length);

      for (const item of expectedItems) {
        await expect(primaryNavigation.getByRole("link", { name: item, exact: true })).toBeVisible();
      }

      await expect(primaryNavigation.getByRole("link", { name: "Dashboard", exact: true })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expectNoHorizontalOverflow(page);
    });
  }

  await page.goto("/actions");
  const actionCentreLink = page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Action Centre", exact: true });
  await expect(actionCentreLink).toHaveAttribute("aria-current", "page");

  await page.goto("/more");
  const closeFeedback = page.getByRole("button", { name: "Close feedback dialog" });
  if (await closeFeedback.isVisible()) await closeFeedback.click({ force: true });
  await expect(page.getByRole("heading", { name: "More" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: /Billing/ })).toBeVisible();
});

test("case workspace keeps the complete review journey inside one shareable case", async ({ page }) => {
  test.setTimeout(120_000);
  await installAuthenticatedMockSession(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/cases/CB-2024-0810");

  const closeFeedback = page.getByRole("button", { name: "Close feedback dialog" });
  if (await closeFeedback.isVisible()) await closeFeedback.click({ force: true });

  const workspace = page.getByRole("tablist", { name: "Case workspace sections" });
  const expectedSections = ["Overview", "Financials", "Communications", "Resolution", "Evidence", "Legal", "Activity"];
  await expect(workspace).toBeVisible({ timeout: 20_000 });
  await expect(workspace.getByRole("tab")).toHaveCount(expectedSections.length);
  await expect(page.getByRole("main").getByLabel("Persistent case summary")).toBeVisible();

  for (const section of expectedSections.slice(1)) {
    await test.step(section, async () => {
      await workspace.getByRole("tab", { name: section, exact: true }).click();
      await expect(workspace.getByRole("tab", { name: section, exact: true })).toHaveAttribute("aria-selected", "true", {
        timeout: 20_000,
      });
      await expect(page).toHaveURL(new RegExp(`section=${section.toLowerCase().replace(" ", "-")}`), { timeout: 20_000 });
      await expectNoHorizontalOverflow(page);
    });
  }

  await page.goto("/cases/CB-2024-0810?tab=payments");
  await expect(page.getByRole("tab", { name: "Financials", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("main").getByText("Record Payment", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Balance discrepancies" })).toBeVisible();
  await expect(page.getByRole("main").getByText("They never change approved financial records", { exact: false })).toBeVisible();

  await page.goto("/cases/CB-2024-0810?section=evidence");
  await expect(page.getByRole("tab", { name: "Evidence", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("main").getByText("Evidence Completeness", { exact: true })).toBeVisible();
});

test("action-first layouts remain usable when reporting or reconciliation is unavailable", async ({ page }) => {
  test.setTimeout(120_000);
  await installAuthenticatedMockSession(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "What needs attention" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Priority work remains available above", { exact: false }).last()).toBeVisible();

  await page.goto("/actions");
  await expect(page.getByRole("heading", { name: "What needs attention" })).toBeVisible({ timeout: 60_000 });
  const actionPanel = page.locator('section[aria-labelledby="action-centre-heading"]:visible');
  await expect(actionPanel.getByRole("alert")).toBeVisible();
  for (const label of ["Team member", "Queue", "Case type", "Severity", "Due date"]) {
    await expect(actionPanel.locator(`select[aria-label="${label}"]`)).toHaveCount(0);
  }
  await expect(actionPanel.getByText("Critical", { exact: true })).toHaveCount(0);

  await page.goto("/cases/CB-2024-0810");
  await expect(
    page.locator('[role="status"]:visible', {
      hasText: "Balance categories are hidden rather than estimated.",
    }),
  ).toBeVisible({ timeout: 60_000 });
  await expectNoHorizontalOverflow(page);
});

test("payment matching queues remain advisory and keyboard-operable", async ({ page }) => {
  test.setTimeout(120_000);
  await installAuthenticatedMockSession(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/operations");

  const panel = page.locator("section:visible").filter({ hasText: "Payment candidate matching" }).first();
  await expect(panel.getByRole("heading", { name: "Payment candidate matching" })).toBeVisible({ timeout: 60_000 });
  await expect(panel.getByText("a person must approve before balances change", { exact: false })).toBeVisible();
  const tabs = panel.getByRole("tablist", { name: "Payment matching queue" });
  await expect(tabs.getByRole("tab")).toHaveCount(3);
  await tabs.getByRole("tab", { name: "Ambiguous" }).press("Enter");
  await expect(tabs.getByRole("tab", { name: "Ambiguous" })).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByText("Split allocations are available only", { exact: false })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
