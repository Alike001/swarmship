import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { LeaseRepository } from "./lease-repository.js";
import { ReleaseRepository } from "./release-repository.js";
import { SpecificationRepository } from "./specification-repository.js";
import {
  closeTestDatabase,
  prepareTestDatabase,
  resetTestDatabase,
  testDatabase,
} from "./test-database.js";

const EVIDENCE = `0x${"44".repeat(32)}` as const;
const specification = {
  contractFamily: "agent-task-registry-v1" as const,
  owner: "0x0000000000000000000000000000000000000001" as const,
  permittedSender: "0x0000000000000000000000000000000000000002" as const,
  permittedReceiver: "0x0000000000000000000000000000000000000003" as const,
  maxHandoffs: 5,
  expiry: 2_000_000_000,
};

describe("SpecificationRepository", () => {
  const leases = new LeaseRepository(testDatabase);
  const releases = new ReleaseRepository(testDatabase);
  const specifications = new SpecificationRepository(testDatabase);

  beforeAll(prepareTestDatabase);
  beforeEach(resetTestDatabase);
  afterAll(closeTestDatabase);

  it("atomically stores an accepted specification and transition", async () => {
    const created = await releases.create({ originalRequest: "Registry" });
    const lease = await leases.claimNext("worker-a", 60, ["created"]);
    if (lease === null) throw new Error("Expected a lease.");

    const transition = await specifications.record({
      command: {
        actor: "specification",
        event: "specification_accepted",
        evidenceRef: EVIDENCE,
        expectedVersion: 0,
      },
      leaseToken: lease.token,
      missingFields: [],
      releaseId: created.release.id,
      specification,
      summary: "A five-use registry for two approved agents.",
      workerId: "worker-a",
    });

    expect(transition).toMatchObject({
      deterministicResult: {
        decision: "accepted",
        missingFields: [],
        specification: { maxHandoffs: 5 },
      },
      event: "specification_accepted",
      safeSummary: "A five-use registry for two approved agents.",
      toState: "specified",
    });
    expect(await releases.get(created.release.id)).toMatchObject({
      leaseOwner: null,
      missingFields: [],
      specification,
      state: "specified",
      version: 1,
    });
  });

  it("stores missing fields without inventing a specification", async () => {
    const created = await releases.create({ originalRequest: "Registry" });
    const lease = await leases.claimNext("worker-a", 60, ["created"]);
    if (lease === null) throw new Error("Expected a lease.");

    await specifications.record({
      command: {
        actor: "specification",
        event: "specification_needs_input",
        evidenceRef: EVIDENCE,
        expectedVersion: 0,
      },
      leaseToken: lease.token,
      missingFields: ["owner"],
      releaseId: created.release.id,
      specification: null,
      summary: "The owner address is missing.",
      workerId: "worker-a",
    });

    expect(await releases.get(created.release.id)).toMatchObject({
      missingFields: ["owner"],
      specification: null,
      state: "needs_input",
    });
  });

  it("rejects output from an expired lease without changing state", async () => {
    const created = await releases.create({ originalRequest: "Registry" });
    const lease = await leases.claimNext("worker-a", 60, ["created"]);
    if (lease === null) throw new Error("Expected a lease.");
    await testDatabase`
      UPDATE releases
      SET lease_expires_at = clock_timestamp() - interval '1 second'
      WHERE id = ${created.release.id}
    `;

    await expect(
      specifications.record({
        command: {
          actor: "specification",
          event: "specification_accepted",
          evidenceRef: EVIDENCE,
          expectedVersion: 0,
        },
        leaseToken: lease.token,
        missingFields: [],
        releaseId: created.release.id,
        specification,
        summary: "A five-use registry for two approved agents.",
        workerId: "worker-a",
      }),
    ).rejects.toMatchObject({ code: "lease_lost" });
    expect(await releases.get(created.release.id)).toMatchObject({
      specification: null,
      state: "created",
      version: 0,
    });
    expect(await releases.listTransitions(created.release.id)).toHaveLength(0);
  });

  it("rejects an accepted event without a canonical specification", async () => {
    const created = await releases.create({ originalRequest: "Registry" });
    const lease = await leases.claimNext("worker-a", 60, ["created"]);
    if (lease === null) throw new Error("Expected a lease.");

    await expect(
      specifications.record({
        command: {
          actor: "specification",
          event: "specification_accepted",
          evidenceRef: EVIDENCE,
          expectedVersion: 0,
        },
        leaseToken: lease.token,
        missingFields: [],
        releaseId: created.release.id,
        specification: null,
        summary: "Claims acceptance without the required fields.",
        workerId: "worker-a",
      }),
    ).rejects.toMatchObject({ code: "transition_rejected" });
    expect(await releases.get(created.release.id)).toMatchObject({
      state: "created",
      version: 0,
    });
  });
});
