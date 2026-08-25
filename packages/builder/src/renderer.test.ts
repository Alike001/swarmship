import { describe, expect, it } from "vitest";

import {
  BUILD_TEMPLATE_FILES,
  BuildRendererError,
  renderTaskRegistry,
} from "./renderer.js";
import { validateBuildEvidence } from "./evidence-validation.js";

const NOW = 1_800_000_000;
const specification = {
  contractFamily: "agent-task-registry-v1",
  owner: "0x0000000000000000000000000000000000000001",
  permittedSender: "0x0000000000000000000000000000000000000002",
  permittedReceiver: "0x0000000000000000000000000000000000000003",
  maxHandoffs: 5,
  expiry: 2_000_000_000,
} as const;

describe("deterministic task registry renderer", () => {
  it("renders only the fixed allowlisted source bundle", async () => {
    const evidence = await renderTaskRegistry(specification, NOW);

    expect(evidence.sourceFiles.map((file) => file.path)).toEqual(
      BUILD_TEMPLATE_FILES,
    );
    expect(evidence.sourceFiles.every((file) => file.content.length > 0)).toBe(
      true,
    );
    expect(evidence.sourceHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(evidence.testInputHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(evidence.evidenceRef).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("produces stable evidence for the same specification", async () => {
    const first = await renderTaskRegistry(specification, NOW);
    const second = await renderTaskRegistry(specification, NOW);

    expect(second).toEqual(first);
    expect(first.sourceHash).toBe(
      "0xc86aaddfc71c1bad482ec8a45b0dd1284736ac48236bd68fe387d231220fffd1",
    );
    expect(first.testInputHash).toBe(
      "0x2917f736fdf5bf1ebc0e52c0aaaadc2e613b1a1186d7661820582dcc9b95e166",
    );
    expect(first.evidenceRef).toBe(
      "0xaa35aa9b88a6f1e6544276c06e2c0fad8715e88eff842483d03a8322e9dda61a",
    );
  });

  it("changes test evidence but not fixed source for another specification", async () => {
    const first = await renderTaskRegistry(specification, NOW);
    const second = await renderTaskRegistry(
      { ...specification, maxHandoffs: 6 },
      NOW,
    );

    expect(second.sourceHash).toBe(first.sourceHash);
    expect(second.testInputHash).not.toBe(first.testInputHash);
    expect(second.evidenceRef).not.toBe(first.evidenceRef);
  });

  it("independently validates the source, inputs, and evidence hashes", async () => {
    const evidence = await renderTaskRegistry(specification, NOW);

    expect(validateBuildEvidence(evidence, specification, NOW)).toEqual(
      evidence,
    );
    expect(() =>
      validateBuildEvidence(
        { ...evidence, sourceHash: `0x${"f".repeat(64)}` },
        specification,
        NOW,
      ),
    ).toThrow("does not match");
    expect(() =>
      validateBuildEvidence(
        evidence,
        { ...specification, maxHandoffs: 6 },
        NOW,
      ),
    ).toThrow("does not match");
  });

  it.each([
    ["missing", null],
    ["unknown family", { ...specification, contractFamily: "other" }],
    ["expired", { ...specification, expiry: NOW }],
    [
      "same agents",
      {
        ...specification,
        permittedReceiver: specification.permittedSender,
      },
    ],
  ])("rejects an invalid %s specification", async (_label, invalid) => {
    await expect(renderTaskRegistry(invalid, NOW)).rejects.toMatchObject({
      code: "invalid_specification",
    } satisfies Partial<BuildRendererError>);
  });
});
