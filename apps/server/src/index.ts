import { serve } from "@hono/node-server";

import { parseServerEnvironment } from "@swarmship/domain/environment";

import { app } from "./app.js";

const environment = parseServerEnvironment(process.env);

serve(
  {
    fetch: app.fetch,
    hostname: environment.HOST,
    port: environment.PORT,
  },
  (info) => {
    console.log(`SwarmShip server listening on port ${info.port}`);
  },
);
