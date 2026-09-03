import { defineCommand } from "citty";
import { consola } from "consola";
import { requireProject, resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";

export default defineCommand({
  meta: {
    name: "resolve",
    description: "Resolve an anomaly alert",
    docs: {
      longDescription:
        "Resolve an anomaly-detection alert by ID. Marks the alert as resolved, indicating the underlying issue has been addressed.",
      examples: [{ comment: "Resolve an anomaly", command: "pgbeam anomalies resolve anom_xxx" }],
      response: "Confirms the anomaly was resolved.",
    },
  },
  args: {
    ...globalArgs,
    id: { type: "positional", description: "Anomaly alert ID", required: true },
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);
      const projectId = requireProject(ctx);

      await ctx.client.anomalies.updateAnomalyAlert({
        pathParams: { project_id: projectId, anomaly_id: args.id },
        body: { status: "resolved" },
      });
      consola.success(`Anomaly ${args.id} resolved.`);
    });
  },
});
