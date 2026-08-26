import { expect, test } from "@playwright/test";

const pages = [
  ["overview", "A contract release pipeline where no agent approves itself."],
  ["quickstart", "Start a real release in three steps."],
  ["mcp", "Two MCP tools, one predictable release boundary."],
  ["architecture", "Trust lives where each decision can be checked."],
] as const;

for (const [docId, heading] of pages) {
  test(`renders the ${docId} documentation without overflow`, async ({
    page,
  }) => {
    await page.goto(`/?docs=${docId}`);
    await expect(
      page.getByRole("heading", { level: 1, name: heading }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Inspect verified proof" }),
    ).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
  });
}

test("documents the complete MCP boundary", async ({ page }) => {
  await page.goto("/?docs=mcp");
  await expect(
    page.getByText("https://swarmship.vercel.app/api/mcp"),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "start_swarmship_release" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "inspect_swarmship_proof" }),
  ).toBeVisible();
});
