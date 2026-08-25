import { renderTaskRegistry } from "@swarmship/builder";
import { toReleaseManifestTypedData } from "@swarmship/domain/release";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ApprovalRepository } from "./approval-repository.js";
import { ReleaseRepository } from "./release-repository.js";
import {
  closeTestDatabase,
  prepareTestDatabase,
  resetTestDatabase,
  testDatabase,
} from "./test-database.js";
import { passedVerificationEvidence } from "./verification-evidence.fixture.js";

const NOW = 1_800_000_000;
const SENDER = "0x0000000000000000000000000000000000000002" as const;
const RECEIVER = "0x0000000000000000000000000000000000000003" as const;

describe("ApprovalRepository", () => {
  const approvals = new ApprovalRepository(testDatabase);
  const releases = new ReleaseRepository(testDatabase);

  beforeAll(prepareTestDatabase);
  beforeEach(resetTestDatabase);
  afterAll(closeTestDatabase);

  async function createAwaitingApproval() {
    const owner = privateKeyToAccount(generatePrivateKey());
    const specification = {
      contractFamily: "agent-task-registry-v1" as const,
      owner: owner.address,
      permittedSender: SENDER,
      permittedReceiver: RECEIVER,
      maxHandoffs: 5,
      expiry: 2_000_000_000,
    };
    const created = await releases.create({ originalRequest: "Registry" });
    const build = await renderTaskRegistry(specification, NOW);
    const verification = passedVerificationEvidence(build.evidenceRef);
    await testDatabase`
      UPDATE releases
      SET state = 'awaiting_approval',
          version = 3,
          specification = ${testDatabase.json(specification)},
          build_evidence = ${testDatabase.json(build)},
          verification_evidence = ${testDatabase.json(verification)},
          updated_at = to_timestamp(${NOW})
      WHERE id = ${created.release.id}
    `;
    return { owner, releaseId: created.release.id };
  }

  async function signatureFor(
    releaseId: string,
    owner: ReturnType<typeof privateKeyToAccount>,
  ) {
    const request = await approvals.getRequest(releaseId, NOW + 1);
    const signature = await owner.signTypedData(
      toReleaseManifestTypedData(request.manifest),
    );
    return { request, signature };
  }

  it("atomically stores the exact owner approval and transition", async () => {
    const { owner, releaseId } = await createAwaitingApproval();
    const { request, signature } = await signatureFor(releaseId, owner);

    const result = await approvals.approve({
      expectedVersion: 3,
      nowUnixSeconds: NOW + 1,
      releaseId,
      signature,
    });

    expect(result).toMatchObject({
      created: true,
      approval: { digest: request.digest, signer: owner.address },
      release: { state: "approved", version: 4 },
      transition: {
        actor: "user",
        event: "approval_granted",
        evidenceRef: request.digest,
        toolName: "approve_release_manifest",
      },
    });
    expect(await releases.get(releaseId)).toMatchObject({
      manifestApproval: { digest: request.digest, signer: owner.address },
      state: "approved",
      version: 4,
    });
  });

  it("returns an identical retry without another transition", async () => {
    const { owner, releaseId } = await createAwaitingApproval();
    const { signature } = await signatureFor(releaseId, owner);
    const first = await approvals.approve({
      expectedVersion: 3,
      nowUnixSeconds: NOW + 1,
      releaseId,
      signature,
    });
    const second = await approvals.approve({
      expectedVersion: 3,
      nowUnixSeconds: NOW + 2,
      releaseId,
      signature,
    });

    expect(first.created).toBe(true);
    expect(second).toMatchObject({ created: false, transition: null });
    expect(await releases.listTransitions(releaseId)).toHaveLength(1);
  });

  it("rejects the wrong wallet without changing release state", async () => {
    const { owner, releaseId } = await createAwaitingApproval();
    const other = privateKeyToAccount(generatePrivateKey());
    const request = await approvals.getRequest(releaseId, NOW + 1);
    const signature = await other.signTypedData(
      toReleaseManifestTypedData(request.manifest),
    );

    await expect(
      approvals.approve({
        expectedVersion: 3,
        nowUnixSeconds: NOW + 1,
        releaseId,
        signature,
      }),
    ).rejects.toMatchObject({ code: "transition_rejected" });
    expect(owner.address).not.toBe(other.address);
    expect(await releases.get(releaseId)).toMatchObject({
      manifestApproval: null,
      state: "awaiting_approval",
      version: 3,
    });
  });

  it("rejects stale, expired, malformed, and duplicate-different approvals", async () => {
    const { owner, releaseId } = await createAwaitingApproval();
    const { signature } = await signatureFor(releaseId, owner);

    await expect(
      approvals.approve({
        expectedVersion: 2,
        nowUnixSeconds: NOW + 1,
        releaseId,
        signature,
      }),
    ).rejects.toMatchObject({ code: "transition_conflict" });
    await expect(
      approvals.approve({
        expectedVersion: 3,
        nowUnixSeconds: NOW + 86_401,
        releaseId,
        signature,
      }),
    ).rejects.toMatchObject({ code: "transition_rejected" });
    await expect(
      approvals.approve({
        expectedVersion: 3,
        nowUnixSeconds: NOW + 1,
        releaseId,
        signature: "0x1234",
      }),
    ).rejects.toMatchObject({ code: "transition_rejected" });

    await approvals.approve({
      expectedVersion: 3,
      nowUnixSeconds: NOW + 1,
      releaseId,
      signature,
    });
    await expect(
      approvals.approve({
        expectedVersion: 3,
        nowUnixSeconds: NOW + 2,
        releaseId,
        signature: `0x${"1".repeat(130)}`,
      }),
    ).rejects.toMatchObject({ code: "approval_conflict" });
  });

  it("removes the approval when the owner amends the release", async () => {
    const { owner, releaseId } = await createAwaitingApproval();
    const { signature } = await signatureFor(releaseId, owner);
    const approved = await approvals.approve({
      expectedVersion: 3,
      nowUnixSeconds: NOW + 1,
      releaseId,
      signature,
    });

    await releases.transition(releaseId, {
      actor: "user",
      event: "release_amended",
      evidenceRef: approved.approval.digest,
      expectedVersion: 4,
    });

    expect(await releases.get(releaseId)).toMatchObject({
      buildEvidence: null,
      manifestApproval: null,
      state: "specified",
      verificationEvidence: null,
      version: 5,
    });
  });
});
