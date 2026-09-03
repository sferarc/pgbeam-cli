import { defineCommand } from "citty";
import { consola } from "consola";
import { PgBeamClient } from "pgbeam";
import { apiBaseUrl } from "../lib/client.js";
import { runCommand } from "../lib/errors.js";
import { globalArgs } from "../lib/flags.js";
import { output } from "../lib/output.js";

export default defineCommand({
  meta: {
    name: "health",
    description: "Check API health status",
    icon: "HeartPulse",
    docs: {
      longDescription:
        "Check the health status of the PgBeam API. Returns the API status and version. This is a public endpoint that does not require authentication. Useful for verifying connectivity and checking which API version is running.",
      examples: [
        { comment: "Check API health", command: "pgbeam platform health" },
        { comment: "Get health status as JSON", command: "pgbeam platform health --json" },
      ],
      response:
        "Displays the API status (e.g. `ok`) and version number. With `--json`, returns the full health response object.",
    },
  },
  args: {
    ...globalArgs,
  },
  async run({ args }) {
    await runCommand(async () => {
      const client = new PgBeamClient({ token: null, baseUrl: apiBaseUrl() }).api;

      const result = await client.platform.getHealth();

      output(result, args.json, () => {
        consola.log(`Status:  ${result.status}`);
        consola.log(`Version: ${result.version}`);
      });
    });
  },
});
