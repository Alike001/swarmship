import type { LeaseRepository } from "@swarmship/persistence";

type LeaseRenewer = Pick<LeaseRepository, "renew">;

export type LeaseHeartbeat = {
  stop: () => Promise<void>;
};

export function startLeaseHeartbeat(input: {
  intervalMs?: number;
  leaseSeconds: number;
  leases: LeaseRenewer;
  releaseId: string;
  token: string;
  workerId: string;
}): LeaseHeartbeat {
  let stopped = false;
  let failure: unknown;
  let renewal = Promise.resolve();
  const intervalMs =
    input.intervalMs ?? Math.max(1_000, input.leaseSeconds * 300);
  const timer = setInterval(() => {
    renewal = renewal
      .then(async () => {
        if (stopped || failure !== undefined) return;
        await input.leases.renew(
          input.releaseId,
          input.workerId,
          input.token,
          input.leaseSeconds,
        );
      })
      .catch((error: unknown) => {
        failure = error;
      });
  }, intervalMs);
  timer.unref();

  return {
    stop: async () => {
      if (!stopped) {
        stopped = true;
        clearInterval(timer);
        await renewal;
      }
      if (failure !== undefined) throw failure;
    },
  };
}
