import { expect, test } from "@playwright/test";

test("explains and starts the five-agent release path", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");

  await expect(page).toHaveTitle("SwarmShip");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Ship contracts through agents you can verify.",
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "One agent should not be able to write, approve, and deploy its own contract release.",
    ),
  ).toBeVisible();

  await page.getByRole("tab", { name: /Witness/ }).click();
  await expect(
    page.getByText("Independently checks what landed onchain"),
  ).toBeVisible();

  await page.route("**/api/releases", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      status: 201,
      body: JSON.stringify({
        release: {
          publicId: "release_1234567890abcdef1234567890abcdef",
          state: "created",
        },
      }),
    });
  });
  await page
    .getByRole("button", { name: "Start the five-agent relay" })
    .click();
  await expect(page.getByText("Request accepted")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open public proof" }),
  ).toBeVisible();
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
  expect(consoleErrors).toEqual([]);
});

test("shows real recorded testnet evidence in plain language", async ({
  page,
}) => {
  await page.goto("/?proof=live");

  await expect(
    page.getByText("Verified release", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "The deployed contract matches the release that was approved.",
    }),
  ).toBeVisible();
  await expect(page.getByText("Five separate responsibilities")).toBeVisible();
  await expect(page.getByText("Arbitrum Sepolia · chain 421614")).toBeVisible();
  await expect(page.getByText("Source verification")).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});

test("never presents a missing proof as verified", async ({ page }) => {
  await page.route("**/api/public/releases/**", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        error: { code: "release_not_found", message: "Release not found." },
      }),
      contentType: "application/json",
      status: 404,
    });
  });
  await page.goto("/?proof=release_ffffffffffffffffffffffffffffffff");

  await expect(page.getByText("Proof unavailable")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "We cannot verify this release." }),
  ).toBeVisible();
  await expect(page.getByText("Verified release", { exact: true })).toHaveCount(
    0,
  );
});
