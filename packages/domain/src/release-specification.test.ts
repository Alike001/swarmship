import { describe, expect, it } from "vitest";

import {
  summarizeTaskRegistrySpec,
  TASK_REGISTRY_CONTRACT_FAMILY,
  validateTaskRegistrySpec,
} from "./release-specification.js";

const NOW = 1_800_000_000;
const OWNER = "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC";
const SENDER = "0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826";
const RECEIVER = "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB";

function validSpecification() {
  return {
    contractFamily: TASK_REGISTRY_CONTRACT_FAMILY,
    owner: OWNER,
    permittedSender: SENDER,
    permittedReceiver: RECEIVER,
    maxHandoffs: 5,
    expiry: NOW + 3_600,
  };
}

describe("task registry specification", () => {
  it("accepts the one supported bounded contract family", () => {
    const result = validateTaskRegistrySpec(validSpecification(), NOW);

    expect(result).toEqual({ success: true, data: validSpecification() });
  });

  it.each([
    [
      "unsupported family",
      { contractFamily: "arbitrary-contract-v1" },
      "contractFamily",
    ],
    ["missing owner", { owner: undefined }, "owner"],
    ["malformed owner", { owner: "0xnot-an-address" }, "owner"],
    [
      "invalid owner checksum",
      { owner: "0xcD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826" },
      "owner",
    ],
    [
      "zero sender",
      { permittedSender: `0x${"0".repeat(40)}` },
      "permittedSender",
    ],
    ["zero limit", { maxHandoffs: 0 }, "maxHandoffs"],
    ["fractional limit", { maxHandoffs: 1.5 }, "maxHandoffs"],
    ["expired permission", { expiry: NOW }, "expiry"],
    ["unreadable expiry", { expiry: 253_402_300_800 }, "expiry"],
  ])("rejects %s with a field-level error", (_, change, field) => {
    const result = validateTaskRegistrySpec(
      { ...validSpecification(), ...change },
      NOW,
    );

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.errors.map((error) => error.field)).toContain(field);
  });

  it("requires separate sending and receiving agents", () => {
    const result = validateTaskRegistrySpec(
      { ...validSpecification(), permittedReceiver: SENDER },
      NOW,
    );

    expect(result).toMatchObject({
      success: false,
      errors: [
        {
          field: "permittedReceiver",
          message:
            "The sending and receiving agents must use different addresses.",
        },
      ],
    });
  });

  it("normalizes a valid lowercase address before it reaches the manifest", () => {
    const result = validateTaskRegistrySpec(
      { ...validSpecification(), owner: SENDER.toLowerCase() },
      NOW,
    );

    expect(result).toMatchObject({ success: true, data: { owner: SENDER } });
  });

  it("rejects unrecognized fields instead of silently dropping them", () => {
    const result = validateTaskRegistrySpec(
      { ...validSpecification(), deploymentNetwork: "mainnet" },
      NOW,
    );

    expect(result).toMatchObject({
      success: false,
      errors: [{ field: "request" }],
    });
  });

  it("explains the exact authority in plain language", () => {
    const result = validateTaskRegistrySpec(validSpecification(), NOW);
    if (!result.success) throw new Error("fixture should be valid");

    expect(summarizeTaskRegistrySpec(result.data)).toEqual({
      title: "Bounded agent task registry",
      ownership: `${OWNER} owns the deployed registry.`,
      permission: `${SENDER} may record task handoffs to ${RECEIVER}.`,
      limit: "The contract accepts at most 5 handoffs.",
      expiry: "The permission ends at 2027-01-15T09:00:00.000Z.",
    });
  });

  it("rejects an invalid clock value instead of bypassing expiry checks", () => {
    expect(() =>
      validateTaskRegistrySpec(validSpecification(), Number.NaN),
    ).toThrow("Current time must be a supported whole Unix timestamp.");
  });
});
