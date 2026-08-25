import type { WorkerEnvironment } from "@swarmship/domain/environment";

export interface WorkerHealth {
  pollIntervalMs: number;
  service: "worker";
  status: "ready";
}

export function getWorkerHealth(
  environment: Pick<WorkerEnvironment, "WORKER_POLL_INTERVAL_MS">,
): WorkerHealth {
  return {
    pollIntervalMs: environment.WORKER_POLL_INTERVAL_MS,
    service: "worker",
    status: "ready",
  };
}
