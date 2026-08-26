import { defineConfig, devices } from "@playwright/test";

const port = 4_318;
const deployedBaseUrl = process.env.PLAYWRIGHT_TEST_BASE_URL;

export default defineConfig({
  expect: {
    timeout: 5_000,
  },
  forbidOnly: Boolean(process.env.CI),
  outputDir: "/tmp/swarmship-playwright-results",
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { height: 900, width: 1_440 },
      },
    },
    {
      name: "mobile-chromium",
      use: devices["Pixel 7"],
    },
  ],
  reporter: "list",
  retries: process.env.CI ? 1 : 0,
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: deployedBaseUrl ?? `http://127.0.0.1:${port}`,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  ...(deployedBaseUrl
    ? {}
    : {
        webServer: {
          command: `pnpm --filter @swarmship/web preview --host 127.0.0.1 --port ${port}`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          url: `http://127.0.0.1:${port}`,
        },
      }),
  workers: 1,
});
