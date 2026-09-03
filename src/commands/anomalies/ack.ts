import { defineCommand } from "citty";
import { consola } from "consola";
import type { AnomalyAlert } from "pgbeam";
import { requireProject, resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";

export default defineCommand({
  meta: {
    name: "ack",
    description: "Acknowledge one or more anomaly alerts",
    docs: {
      longDescription:
        "Acknowledge anomaly-detection alerts. Pass one or more alert IDs, or use `--all` to acknowledge every open alert for the linked project (mirrors the dashboard's bulk acknowledge). Marks each alert as acknowledged, indicating it has been seen and is being handled.",
      examples: [
        { comment: "Acknowledge an anomaly", command: "pgbeam anomalies ack anom_xxx" },
        {
          comment: "Acknowledge several anomalies at once",
          command: "pgbeam anomalies ack anom_xxx anom_yyy",
        },
        { comment: "Acknowledge every open anomaly", command: "pgbeam anomalies ack --all" },
      ],
      response:
        "Confirms each anomaly was acknowledged; bulk runs end with an acknowledged/failed summary and exit non-zero if any update failed.",
    },
  },
  args: {
    ...globalArgs,
    id: { type: "positional", description: "Anomaly alert ID(s)", required: false },
    all: {
      type: "boolean",
      description: "Acknowledge every open anomaly alert in the project",
      default: false,
    },
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);
      const projectId = requireProject(ctx);

      // Citty assigns the first positional to `id` and keeps every positional
      // (including the first) in `_`, so `_` carries the full ID list.
      const ids = [
        ...new Set(
          [args.id, ...(args._ ?? [])].filter(
            (v): v is string => typeof v === "string" && v.trim().length > 0,
          ),
        ),
      ];

      if (args.all && ids.length > 0) {
        throw new Error("Pass either alert IDs or --all, not both.");
      }
      if (!args.all && ids.length === 0) {
        throw new Error(
          "Provide at least one anomaly alert ID, or use --all for every open alert.",
        );
      }

      let targets = ids;
      if (args.all) {
        const open: AnomalyAlert[] = [];
        let pageToken: string | undefined;
        do {
          const result = await ctx.client.anomalies.listAnomalyAlerts({
            pathParams: { project_id: projectId },
            queryParams: {
              status: "open",
              page_size: 100,
              ...(pageToken ? { page_token: pageToken } : {}),
            },
          });
          open.push(...result.anomalies);
          pageToken = result.next_page_token;
        } while (pageToken);

        if (open.length === 0) {
          consola.info("No open anomaly alerts to acknowledge.");
          return;
        }
        targets = open.map((a) => a.id);
      }

      // Acknowledge sequentially, counting failures instead of aborting on the
      // first one (mirrors the dashboard bulk acknowledge).
      let acknowledged = 0;
      const failed: string[] = [];
      for (const id of targets) {
        try {
          await ctx.client.anomalies.updateAnomalyAlert({
            pathParams: { project_id: projectId, anomaly_id: id },
            body: { status: "acknowledged" },
          });
          acknowledged += 1;
        } catch {
          failed.push(id);
        }
      }

      if (targets.length === 1 && failed.length === 0) {
        consola.success(`Anomaly ${targets[0]} acknowledged.`);
        return;
      }
      if (failed.length === 0) {
        consola.success(`Acknowledged ${acknowledged} anomaly alerts.`);
        return;
      }
      throw new Error(
        `Acknowledged ${acknowledged}, failed ${failed.length}: ${failed.join(", ")}. Retry the rest.`,
      );
    });
  },
});
