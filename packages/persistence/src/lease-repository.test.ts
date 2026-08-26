import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { LeaseRepository } from "./lease-repository.js";
import { ReleaseRepository } from "./release-repository.js";
import {
  closeTestDatabase,
  prepareTestDatabase,
  resetTestDatabase,
  testDatabase,
} from "./test-database.js";

describe("LeaseRepository", () => {
  const leases = new LeaseRepository(testDatabase);
  const releases = new ReleaseRepository(testDatabase);

  beforeAll(prepareTestDatabase);
  beforeEach(resetTestDatabase);
  afterAll(closeTestDatabase);

  it("allows only one worker to claim a release", async () => {
    const { release } = await releases.create({ originalRequest: "Registry" });
    const claims = await Promise.all([
      leases.claimNext("worker-a", 60),
      leases.claimNext("worker-b", 60),
    ]);

    const successful = claims.filter((claim) => claim !== null);
    expect(successful).toHaveLength(1);
    expect(successful[0]?.release.id).toBe(release.id);
    expect(claims.filter((claim) => claim === null)).toHaveLength(1);
  });

  it("requires the current owner and token to renew or release", async () => {
    await releases.create({ originalRequest: "Registry" });
    const claim = await leases.claimNext("worker-a", 60);
    expect(claim).not.toBeNull();
    if (claim === null) throw new Error("Expected a lease.");

    await expect(
      leases.renew(claim.release.id, "worker-b", claim.token, 60),
    ).rejects.toMatchObject({ code: "lease_lost" });
    await expect(
      leases.release(
        claim.release.id,
        "worker-a",
        "00000000-0000-4000-8000-000000000000",
      ),
    ).rejects.toMatchObject({ code: "lease_lost" });

    const renewed = await leases.renew(
      claim.release.id,
      "worker-a",
      claim.token,
      60,
    );
    expect(renewed.release.leaseOwner).toBe("worker-a");
    await leases.release(claim.release.id, "worker-a", claim.token);
    expect(await leases.claimNext("worker-b", 60)).not.toBeNull();
  });

  it("allows an expired lease to be reclaimed", async () => {
    await releases.create({ originalRequest: "Registry" });
    const first = await leases.claimNext("worker-a", 60);
    expect(first).not.toBeNull();
    if (first === null) throw new Error("Expected a lease.");

    await testDatabase`
      UPDATE releases
      SET lease_expires_at = clock_timestamp() - interval '1 second'
      WHERE id = ${first.release.id}
    `;
    const reclaimed = await leases.claimNext("worker-b", 60);

    expect(reclaimed?.release.id).toBe(first.release.id);
    expect(reclaimed?.release.leaseOwner).toBe("worker-b");
    expect(reclaimed?.token).not.toBe(first.token);
  });

  it("rejects unsafe lease durations before querying", async () => {
    await expect(leases.claimNext("worker", 0)).rejects.toThrow(RangeError);
    await expect(leases.claimNext("worker", 3601)).rejects.toThrow(RangeError);
  });

  it("claims only the states requested by the worker", async () => {
    const waiting = await releases.create({ originalRequest: "Waiting" });
    await testDatabase`
      UPDATE releases SET state = 'needs_input' WHERE id = ${waiting.release.id}
    `;
    const ready = await releases.create({ originalRequest: "Ready" });

    const claim = await leases.claimNext("specification-worker", 60, [
      "created",
    ]);

    expect(claim?.release.id).toBe(ready.release.id);
  });

  it("claims only the reconciliation kind requested by the worker", async () => {
    const deployment = await releases.create({ originalRequest: "Deployment" });
    const manifest = await releases.create({ originalRequest: "Manifest" });
    await testDatabase`
      UPDATE releases
      SET state = 'reconciliation_required', reconciliation_kind = 'deployment'
      WHERE id = ${deployment.release.id}
    `;
    await testDatabase`
      UPDATE releases
      SET state = 'reconciliation_required', reconciliation_kind = 'manifest_anchor'
      WHERE id = ${manifest.release.id}
    `;

    const claim = await leases.claimNext(
      "manifest-worker",
      60,
      ["reconciliation_required"],
      ["manifest_anchor"],
    );

    expect(claim?.release.id).toBe(manifest.release.id);
  });

  it("defers a provider failure and clears the current lease", async () => {
    const created = await releases.create({ originalRequest: "Registry" });
    const claim = await leases.claimNext("worker-a", 60, ["created"]);
    if (claim === null) throw new Error("Expected a lease.");

    await leases.defer(
      claim.release.id,
      "worker-a",
      claim.token,
      { code: "model_quota_exhausted", message: "API quota is unavailable." },
      300,
    );

    expect(await releases.get(created.release.id)).toMatchObject({
      leaseOwner: null,
      leaseToken: null,
      retryCount: 1,
      safeError: {
        code: "model_quota_exhausted",
        message: "API quota is unavailable.",
      },
    });
    expect(await leases.claimNext("worker-b", 60, ["created"])).toBeNull();
  });
});
