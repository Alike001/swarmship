import { expect, test } from "@playwright/test";
import { keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

test("asks for an owner wallet without pretending approval succeeded", async ({
  page,
}) => {
  const publicId = "release_abcdefabcdefabcdefabcdefabcdefab";
  await page.route(`**/api/public/releases/${publicId}`, async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        release: {
          approval: null,
          build: null,
          deployment: null,
          manifestAnchor: null,
          publicId,
          receipt: null,
          releaseId: "04f36195-b7b0-4b02-ae7e-2ed049779cb7",
          request: "Create a bounded registry for approved agent handoffs.",
          safeError: null,
          specification: {
            owner: "0xdE67A35B322e5A31e8215B5245CA4e48d7977F71",
          },
          specificationSummary: "One bounded registry on Arbitrum Sepolia.",
          state: "awaiting_approval",
          verification: null,
          version: 3,
        },
        transitions: [],
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await page.goto(`/?proof=${publicId}`);
  await page
    .getByRole("button", { name: "Review and sign exact release" })
    .click();
  await expect(page.getByRole("alert")).toHaveText(
    "Open this page in a browser with MetaMask or another EVM wallet.",
  );
  await expect(page.getByText("Verified release", { exact: true })).toHaveCount(
    0,
  );
});

test("signs the exact typed release with the connected owner", async ({
  page,
}) => {
  const owner = privateKeyToAccount(
    keccak256(toHex("swarmship-browser-owner")),
  );
  const publicId = "release_12341234123412341234123412341234";
  const releaseId = "12341234-1234-4234-8234-123412341234";
  const typedData = {
    domain: { chainId: 421614, name: "SwarmShip", version: "1" },
    message: {
      approvalExpiry: 1_900_000_000,
      artifactHash: `0x${"1".repeat(64)}` as const,
      chainId: 421614,
      nonce: "3",
      releaseId: `0x${"2".repeat(64)}` as const,
      sourceHash: `0x${"3".repeat(64)}` as const,
      specification: {
        expiry: 1_900_000_000,
        maxHandoffs: 100,
        owner: owner.address,
        permittedReceiver: "0x1111111111111111111111111111111111111111",
        permittedSender: owner.address,
      },
      testEvidenceHash: `0x${"4".repeat(64)}` as const,
      toolchainHash: `0x${"5".repeat(64)}` as const,
      version: 1,
    },
    primaryType: "ReleaseManifestV1" as const,
    types: {
      ReleaseManifestV1: [
        { name: "version", type: "uint16" },
        { name: "releaseId", type: "bytes32" },
        { name: "specification", type: "TaskRegistrySpecV1" },
        { name: "sourceHash", type: "bytes32" },
        { name: "artifactHash", type: "bytes32" },
        { name: "testEvidenceHash", type: "bytes32" },
        { name: "toolchainHash", type: "bytes32" },
        { name: "chainId", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "approvalExpiry", type: "uint64" },
      ],
      TaskRegistrySpecV1: [
        { name: "owner", type: "address" },
        { name: "permittedSender", type: "address" },
        { name: "permittedReceiver", type: "address" },
        { name: "maxHandoffs", type: "uint64" },
        { name: "expiry", type: "uint64" },
      ],
    },
  } as const;
  const signature = await owner.signTypedData(typedData);
  await page.addInitScript(
    ({ address, signed }) => {
      Object.defineProperty(window, "ethereum", {
        value: {
          request: async ({
            method,
            params,
          }: {
            method: string;
            params?: readonly unknown[];
          }) => {
            if (method === "eth_requestAccounts") return [address];
            if (method === "eth_signTypedData_v4") {
              localStorage.setItem(
                "swarmship-signed-data",
                String(params?.[1]),
              );
              return signed;
            }
            throw new Error(`Unexpected wallet method: ${method}`);
          },
        },
      });
    },
    { address: owner.address, signed: signature },
  );
  await page.route(`**/api/public/releases/${publicId}`, async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        release: {
          approval: null,
          build: null,
          deployment: null,
          manifestAnchor: null,
          publicId,
          receipt: null,
          releaseId,
          request: "Create a bounded registry.",
          safeError: null,
          specification: { owner: owner.address },
          specificationSummary: null,
          state: "awaiting_approval",
          verification: null,
          version: 3,
        },
        transitions: [],
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route(`**/api/releases/${releaseId}/approval`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        body: JSON.stringify({
          approval: { digest: typedData.message.releaseId, typedData },
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    expect(await route.request().postDataJSON()).toEqual({
      expectedVersion: 3,
      signature,
    });
    await route.fulfill({
      body: "{}",
      contentType: "application/json",
      status: 201,
    });
  });

  await page.goto(`/?proof=${publicId}`);
  await page
    .getByRole("button", { name: "Review and sign exact release" })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("swarmship-signed-data")),
    )
    .not.toBeNull();
  expect(
    await page.evaluate(() => localStorage.getItem("swarmship-signed-data")),
  ).toContain("EIP712Domain");
});
