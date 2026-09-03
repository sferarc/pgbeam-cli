import { defineCommand } from "citty";
import { consola } from "consola";
import type { AnomalyAlert, AnomalyAlertStatusEnumKey } from "pgbeam";
import { requireProject, resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";
import { formatDate, output, outputTable } from "../../lib/output.js";

export default defineCommand({
  meta: {
    name: "list",
    description: "List anomaly-detection alerts for a project",
    docs: {
      longDescription:
        "List anomaly-detection alerts for the linked project. Shows each alert's ID, severity, kind, title, status, and creation time. Use `--status` to filter by open, acknowledged, or resolved alerts.",
      examples: [
        { comment: "List anomaly alerts", command: "pgbeam anomalies list" },
        {
          comment: "List only open alerts",
          command: "pgbeam anomalies list --status open",
        },
        { comment: "List as JSON", command: "pgbeam anomalies list --json" },
      ],
      response:
        "Displays a table with columns: ID, Severity, Kind, Title, Status, and Created. With `--json`, returns the full list of anomaly alerts.",
    },
  },
  args: {
    ...globalArgs,
    status: {
      type: "string",
      description: "Filter by status: open, acknowledged, or resolved",
    },
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);
      const projectId = requireProject(ctx);

      const status = args.status as AnomalyAlertStatusEnumKey | undefined;

      const result = await ctx.client.anomalies.listAnomalyAlerts({
        pathParams: { project_id: projectId },
        queryParams: { page_size: 50, ...(status ? { status } : {}) },
      });

      output(result, args.json, () => {
        if (result.anomalies.length === 0) {
          consola.info("No anomaly alerts found.");
          return;
        }

        outputTable(
          result.anomalies.map((a: AnomalyAlert) => ({
            id: a.id,
            severity: a.severity,
            kind: a.kind,
            title: a.title.length > 40 ? `${a.title.substring(0, 39)}…` : a.title,
            status: a.status,
            created: formatDate(a.created_at),
          })),
          [
            { key: "id", label: "ID" },
            { key: "severity", label: "Severity" },
            { key: "kind", label: "Kind" },
            { key: "title", label: "Title" },
            { key: "status", label: "Status" },
            { key: "created", label: "Created" },
          ],
        );
      });
    });
  },
});
