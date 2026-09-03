import { defineCommand } from "citty";
import { consola } from "consola";
import { requireOrg, resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";
import { output, outputTable } from "../../lib/output.js";

export default defineCommand({
  meta: {
    name: "usage",
    description: "Show organization usage",
    docs: {
      longDescription:
        "Display aggregated usage metrics for the active organization over a date range. Shows daily breakdowns of total queries, cache hits, and data transferred across all projects. Defaults to the current calendar month if no date range is specified.",
      examples: [
        { comment: "Show usage for the current month", command: "pgbeam orgs usage" },
        {
          comment: "Show usage for a specific date range",
          command: "pgbeam orgs usage --start-date 2025-01-01 --end-date 2025-01-31",
        },
        { comment: "Get usage as JSON", command: "pgbeam orgs usage --json" },
      ],
      response:
        "Displays total queries and data transferred, followed by a day-by-day table with columns: Day, Queries, Cache Hits, and Data. With `--json`, returns the full usage response.",
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
      const orgId = requireOrg(ctx);

      const now = new Date();
      const endDate = args["end-date"] ?? now.toISOString().split("T")[0];
      const startDate =
        args["start-date"] ??
        new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];

      const result = await ctx.client.analytics.getOrganizationUsage({
        pathParams: { org_id: orgId },
        queryParams: { start_date: startDate, end_date: endDate },
      });

      output(result, args.json, () => {
        consola.log(`Organization: ${orgId}`);
        consola.log(`Period:       ${startDate} to ${endDate}\n`);

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
            queries: d.queries_total.toLocaleString(),
            cache_hits: d.cache_hits.toLocaleString(),
            data: formatBytes(d.bytes_transferred),
          })),
          [
            { key: "day", label: "Day" },
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
