import { expect, test } from "@playwright/test";

test("renders the honest foundation surface", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");

  await expect(page).toHaveTitle("SwarmShip");
  await expect(
    page.getByRole("heading", { level: 1, name: "SwarmShip" }),
  ).toBeVisible();
  await expect(
    page.getByText("Multi-agent smart contract releases you can prove."),
  ).toBeVisible();
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
  expect(consoleErrors).toEqual([]);
});
