import { parseWorkerEnvironment } from "@swarmship/domain";

import { getWorkerHealth } from "./health.js";

const environment = parseWorkerEnvironment(process.env);
const health = getWorkerHealth(environment);

console.log(
  `SwarmShip worker ready with ${health.pollIntervalMs}ms polling disabled until release processing is implemented`,
);
