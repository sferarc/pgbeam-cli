import { defineCommand } from "citty";
import { consola } from "consola";
import { parseNumber } from "../lib/args.js";
import { requireProject, resolveContext } from "../lib/client.js";
import { runCommand } from "../lib/errors.js";
import { globalArgs } from "../lib/flags.js";
import { output, outputTable } from "../lib/output.js";

export default defineCommand({
  meta: {
    name: "metrics",
    description: "Show project metrics",
    docs: {
      longDescription:
        "Display real-time performance metrics for the linked project, including query counts, cache hits, active connections, and latency percentiles. Results are broken down by region. Use `--limit` to control how many snapshots to return and `--region` to filter by a specific region.",
      examples: [
        { comment: "Show the latest 10 metric snapshots", command: "pgbeam analytics metrics" },
        { comment: "Show the latest 20 snapshots", command: "pgbeam analytics metrics --limit 20" },
        { comment: "Filter by region", command: "pgbeam analytics metrics --region us-east-1" },
        { comment: "Get metrics as JSON", command: "pgbeam analytics metrics --json" },
      ],
      response:
        "Displays a table with columns: Region, Queries, Cache Hits, Connections, Avg (ms), and P99 (ms). With `--json`, returns the full metrics snapshot array.",
    },
  },
  args: {
    ...globalArgs,
    limit: {
      type: "string",
      description: "Maximum number of metric snapshots to return",
      default: "10",
    },
    region: {
      type: "string",
      description: "Filter results to a specific region (e.g. us-east-1)",
    },
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);
      const projectId = requireProject(ctx);

      const result = await ctx.client.projects.getProjectMetrics({
        pathParams: { project_id: projectId },
        queryParams: {
          limit: parseNumber(args.limit, "limit"),
          region: args.region,
        },
      });

      output(result, args.json, () => {
        if (result.snapshots.length === 0) {
          consola.info("No metrics available.");
          return;
        }

        outputTable(
          result.snapshots.map((s) => ({
            region: s.region,
            queries: s.queries_total.toLocaleString(),
            cache_hits: s.cache_hits.toLocaleString(),
            connections: s.active_connections,
            avg_ms: s.avg_latency_ms.toFixed(1),
            p99_ms: s.p99_latency_ms.toFixed(1),
          })),
          [
            { key: "region", label: "Region" },
            { key: "queries", label: "Queries" },
            { key: "cache_hits", label: "Cache Hits" },
            { key: "connections", label: "Connections" },
            { key: "avg_ms", label: "Avg (ms)" },
            { key: "p99_ms", label: "P99 (ms)" },
          ],
        );
      });
    });
  },
});
