import { describe, expect, it } from "vitest";

import { PRODUCT } from "@swarmship/domain";

describe("web foundation", () => {
  it("uses the approved public identity and network", () => {
    expect(PRODUCT).toMatchObject({
      name: "SwarmShip",
      network: "Arbitrum Sepolia",
      networkChainId: 421_614,
    });
  });
});
