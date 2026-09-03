import { defineCommand } from "citty";
import { consola } from "consola";
import { insightRanges, parseEnum } from "../lib/args.js";
import { requireProject, resolveContext } from "../lib/client.js";
import { runCommand } from "../lib/errors.js";
import { globalArgs } from "../lib/flags.js";
import { output, outputTable } from "../lib/output.js";

export default defineCommand({
  meta: {
    name: "insights",
    description: "Show project query insights",
    docs: {
      longDescription:
        "Display query performance insights for the linked project, including cache hit rate, average and P99 latency, and the top queries by call count. Use `--range` to adjust the time window.",
      examples: [
        {
          comment: "Show insights for the last 24 hours (default)",
          command: "pgbeam analytics insights",
        },
        {
          comment: "Show insights for the last hour",
          command: "pgbeam analytics insights --range 1h",
        },
        {
          comment: "Show insights for the last 7 days",
          command: "pgbeam analytics insights --range 7d",
        },
        { comment: "Get insights as JSON", command: "pgbeam analytics insights --json" },
      ],
      response:
        "Displays cache hit rate, average latency, and P99 latency, followed by a table of top queries with columns: Query (truncated), Count, Avg (ms), and Cache Hits. With `--json`, returns the full insights response.",
    },
  },
  args: {
    ...globalArgs,
    range: {
      type: "string",
      description: "Time window for insights: 1h, 6h, 24h, or 7d",
      default: "24h",
    },
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);
      const projectId = requireProject(ctx);

      const result = await ctx.client.analytics.getProjectInsights({
        pathParams: { project_id: projectId },
        queryParams: { range: parseEnum(args.range, insightRanges, "range") },
      });

      output(result, args.json, () => {
        consola.log(`Cache hit rate: ${(result.cache.hit_rate * 100).toFixed(1)}%`);
        consola.log(`Avg latency:    ${result.latency.avg_ms.toFixed(1)}ms`);
        consola.log(`P99 latency:    ${result.latency.p99_ms.toFixed(1)}ms\n`);

        if (result.queries.length > 0) {
          consola.log("Top queries:\n");
          outputTable(
            result.queries.map((q) => ({
              pattern: q.query_pattern.substring(0, 60),
              count: q.total_count.toLocaleString(),
              avg_ms: q.avg_latency_ms.toFixed(1),
              cache_hits: q.total_cache_hits.toLocaleString(),
            })),
            [
              { key: "pattern", label: "Query" },
              { key: "count", label: "Count" },
              { key: "avg_ms", label: "Avg (ms)" },
              { key: "cache_hits", label: "Cache Hits" },
            ],
          );
        } else {
          consola.info("No query insights available for this range.");
        }
      });
    });
  },
});
