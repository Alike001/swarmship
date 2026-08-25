import type { WorkerEnvironment } from "@swarmship/domain";

export interface WorkerHealth {
  pollIntervalMs: number;
  service: "worker";
  status: "ready";
}

export function getWorkerHealth(environment: WorkerEnvironment): WorkerHealth {
  return {
    pollIntervalMs: environment.WORKER_POLL_INTERVAL_MS,
    service: "worker",
    status: "ready",
  };
}
