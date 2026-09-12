import { chromium, type FullConfig } from "@playwright/test";

export default async function warmLocalApp(config: FullConfig) {
  if (process.env.PLAYWRIGHT_SKIP_GLOBAL_WARMUP === "true") return;
  const baseURL = config.projects[0]?.use.baseURL?.toString() ?? "http://127.0.0.1:3100";
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    await page.goto(`${baseURL}/landing`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: /Collect overdue payments.*With confidence/ }).waitFor({
      state: "visible",
      timeout: 120_000,
    });
  } finally {
    await browser.close();
  }
}
