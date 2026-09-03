import { defineCommand } from "citty";
import { consola } from "consola";
import type { CacheRuleEntry } from "pgbeam";
import { parseNumber, requireArg } from "../../lib/args.js";
import { requireProject, resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";
import { output, outputTable } from "../../lib/output.js";

export default defineCommand({
  meta: {
    name: "list",
    description: "List cache rules for a database",
    docs: {
      longDescription:
        "List all tracked query shapes and their caching status for a database. Shows the query hash, a truncated SQL pattern, query type, whether caching is enabled, call count, average latency, and PgBeam's caching recommendation. Results are paginated — use `--page-size` and `--page-token` to navigate pages.",
      examples: [
        {
          comment: "List cache rules for a database",
          command: "pgbeam cache-rules list --database-id db_xxx",
        },
        {
          comment: "Get the first 20 rules",
          command: "pgbeam cache-rules list --database-id db_xxx --page-size 20",
        },
        {
          comment: "Get the next page using a pagination token",
          command: "pgbeam cache-rules list --database-id db_xxx --page-token <token>",
        },
        { comment: "List as JSON", command: "pgbeam cache-rules list --database-id db_xxx --json" },
      ],
      response:
        "Displays a table with columns: Hash, Query, Type, Cached, Calls, Avg (ms), and Recommendation. If more pages are available, prints the `--page-token` value for the next page. With `--json`, returns the full paginated response.",
    },
  },
  args: {
    ...globalArgs,
    "database-id": {
      type: "string",
      description: "ID of the database whose cache rules to list",
      required: true,
    },
    "page-size": {
      type: "string",
      description: "Number of entries per page (1-100). Defaults to the API default.",
    },
    "page-token": {
      type: "string",
      description: "Pagination token returned from a previous list call to fetch the next page",
    },
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);
      const projectId = requireProject(ctx);
      const databaseId = requireArg(args["database-id"], "database-id");

      const result = await ctx.client.projects.listCacheRules({
        pathParams: { project_id: projectId, database_id: databaseId },
        queryParams: {
          page_size: args["page-size"] ? parseNumber(args["page-size"], "page-size") : undefined,
          page_token: args["page-token"] ?? undefined,
        },
      });

      output(result, args.json, () => {
        if (result.entries.length === 0) {
          consola.info("No cache rules found.");
          return;
        }

        outputTable(
          result.entries.map((e: CacheRuleEntry) => ({
            hash: e.query_hash,
            sql: e.normalized_sql,
            type: e.query_type,
            cached: e.cache_enabled ? "yes" : "no",
            calls: e.call_count.toLocaleString(),
            avg_ms: e.avg_latency_ms.toFixed(1),
            rec: e.recommendation,
          })),
          [
            { key: "hash", label: "Hash" },
            { key: "sql", label: "Query" },
            { key: "type", label: "Type" },
            { key: "cached", label: "Cached" },
            { key: "calls", label: "Calls" },
            { key: "avg_ms", label: "Avg (ms)" },
            { key: "rec", label: "Recommendation" },
          ],
        );

        if (result.next_page_token) {
          consola.log(`\nNext page: --page-token ${result.next_page_token}`);
        }
      });
    });
  },
});
