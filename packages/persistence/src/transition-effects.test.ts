import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ReleaseRepository } from "./release-repository.js";
import {
  closeTestDatabase,
  prepareTestDatabase,
  resetTestDatabase,
  testDatabase,
} from "./test-database.js";

const EVIDENCE = `0x${"44".repeat(32)}` as const;

describe("persisted transition effects", () => {
  const releases = new ReleaseRepository(testDatabase);

  beforeAll(prepareTestDatabase);
  beforeEach(resetTestDatabase);
  afterAll(closeTestDatabase);

  it("invalidates build evidence and approval in the transition transaction", async () => {
    const { release } = await releases.create({ originalRequest: "Registry" });
    await testDatabase`
      UPDATE releases
      SET state = 'awaiting_approval',
          version = 5,
          build_evidence = ${testDatabase.json({ artifactHash: EVIDENCE })},
          verification_evidence = ${testDatabase.json({ evidenceRef: EVIDENCE })},
          manifest_approval = ${testDatabase.json({ signature: "0xsigned" })}
      WHERE id = ${release.id}
    `;

    const transition = await releases.transition(release.id, {
      actor: "user",
      event: "release_amended",
      expectedVersion: 5,
      evidenceRef: EVIDENCE,
    });
    const updated = await releases.get(release.id);

    expect(transition.effects).toEqual([
      "invalidate_build_evidence",
      "invalidate_manifest_approval",
    ]);
    expect(updated).toMatchObject({
      state: "specified",
      version: 6,
      buildEvidence: null,
      manifestApproval: null,
      verificationEvidence: null,
    });
  });
});
