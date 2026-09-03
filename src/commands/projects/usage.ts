import { defineCommand } from "citty";
import { consola } from "consola";
import { requireProject, resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";
import { output, outputTable } from "../../lib/output.js";

export default defineCommand({
  meta: {
    name: "usage",
    description: "Show project usage",
    docs: {
      longDescription:
        "Display usage metrics for the linked project over a date range. Shows daily breakdowns of total queries, cache hits, and data transferred by region. Defaults to the current calendar month if no date range is specified.",
      examples: [
        { comment: "Show usage for the current month", command: "pgbeam projects usage" },
        {
          comment: "Show usage for a specific date range",
          command: "pgbeam projects usage --start-date 2025-01-01 --end-date 2025-01-31",
        },
        {
          comment: "Get usage data as JSON for further processing",
          command: "pgbeam projects usage --json",
        },
      ],
      response:
        "Displays total queries and data transferred, followed by a day-by-day table with columns: Day, Region, Queries, Cache Hits, and Data. With `--json`, returns the full usage response from the API.",
    },
  },
  args: {
    ...globalArgs,
    "start-date": {
      type: "string",
      description:
        "Start of the date range in YYYY-MM-DD format. Defaults to the first day of the current month.",
    },
    "end-date": {
      type: "string",
      description: "End of the date range in YYYY-MM-DD format. Defaults to today.",
    },
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);
      const projectId = requireProject(ctx);

      const now = new Date();
      const endDate = args["end-date"] ?? now.toISOString().split("T")[0];
      const startDate =
        args["start-date"] ??
        new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];

      const result = await ctx.client.analytics.getProjectUsage({
        pathParams: { project_id: projectId },
        queryParams: { start_date: startDate, end_date: endDate },
      });

      output(result, args.json, () => {
        consola.log(`Project: ${projectId}`);
        consola.log(`Period:  ${startDate} to ${endDate}\n`);

        if (result.usage.length === 0) {
          consola.info("No usage data available for this period.");
          return;
        }

        const totalQueries = result.usage.reduce((sum, d) => sum + d.queries_total, 0);
        const totalBytes = result.usage.reduce((sum, d) => sum + d.bytes_transferred, 0);
        consola.log(`Total queries: ${totalQueries.toLocaleString()}`);
        consola.log(`Total data:    ${formatBytes(totalBytes)}\n`);

        outputTable(
          result.usage.map((d) => ({
            day: d.day,
            region: d.region,
            queries: d.queries_total.toLocaleString(),
            cache_hits: d.cache_hits.toLocaleString(),
            data: formatBytes(d.bytes_transferred),
          })),
          [
            { key: "day", label: "Day" },
            { key: "region", label: "Region" },
            { key: "queries", label: "Queries" },
            { key: "cache_hits", label: "Cache Hits" },
            { key: "data", label: "Data" },
          ],
        );
      });
    });
  },
});

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}
