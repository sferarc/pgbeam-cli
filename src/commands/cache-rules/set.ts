import { defineCommand } from "citty";
import { consola } from "consola";
import { requireArg } from "../../lib/args.js";
import { requireProject, resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";
import { output } from "../../lib/output.js";

export default defineCommand({
  meta: {
    name: "set",
    description: "Update cache rule for a query",
    docs: {
      longDescription:
        "Enable or disable caching for a specific query shape, identified by its xxhash64 hash. You can optionally override the TTL (time-to-live) and SWR (stale-while-revalidate) durations. Omitting `--ttl` or `--swr` uses the project-level defaults. Use `pgbeam cache-rules list` to find query hashes.",
      examples: [
        {
          comment: "Enable caching for a query",
          command: "pgbeam cache-rules set a1b2c3d4 --database-id db_xxx --enabled true",
        },
        {
          comment: "Enable with custom TTL and SWR",
          command:
            "pgbeam cache-rules set a1b2c3d4 --database-id db_xxx --enabled true --ttl 60 --swr 10",
        },
        {
          comment: "Disable caching for a query",
          command: "pgbeam cache-rules set a1b2c3d4 --database-id db_xxx --enabled false",
        },
      ],
      response:
        "Prints the updated cache rule showing whether caching is enabled, the TTL, and the SWR duration. With `--json`, returns the full cache rule entry.",
    },
  },
  args: {
    ...globalArgs,
    "database-id": {
      type: "string",
      description: "ID of the database that owns the query",
      required: true,
    },
    "query-hash": {
      type: "positional",
      description:
        "Query hash (xxhash64 hex) identifying the query shape. Find this via `pgbeam cache-rules list`.",
      required: true,
    },
    enabled: {
      type: "string",
      description: 'Whether to enable caching for this query: "true" or "false"',
      required: true,
    },
    ttl: {
      type: "string",
      description: "TTL (time-to-live) override in seconds. Omit to use the project default.",
    },
    swr: {
      type: "string",
      description:
        "SWR (stale-while-revalidate) override in seconds. Omit to use the project default.",
    },
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);
      const projectId = requireProject(ctx);
      const databaseId = requireArg(args["database-id"], "database-id");
      const queryHash = requireArg(args["query-hash"], "query-hash");

      const enabledStr = requireArg(args.enabled, "enabled");
      if (enabledStr !== "true" && enabledStr !== "false") {
        throw new Error('--enabled must be "true" or "false".');
      }
      const cacheEnabled = enabledStr === "true";

      const ttl = args.ttl ? Number(args.ttl) : undefined;
      const swr = args.swr ? Number(args.swr) : undefined;

      if (ttl !== undefined && Number.isNaN(ttl)) {
        throw new Error("--ttl must be a number.");
      }
      if (swr !== undefined && Number.isNaN(swr)) {
        throw new Error("--swr must be a number.");
      }

      const result = await ctx.client.projects.updateCacheRule({
        pathParams: {
          project_id: projectId,
          database_id: databaseId,
          query_hash: queryHash,
        },
        body: {
          cache_enabled: cacheEnabled,
          cache_ttl_seconds: ttl ?? null,
          cache_swr_seconds: swr ?? null,
        },
      });

      output(result, args.json, () => {
        consola.success(`Cache rule updated for query ${queryHash}.`);
        consola.log(`  Cached:  ${result.entry.cache_enabled ? "yes" : "no"}`);
        consola.log(`  TTL:     ${result.entry.cache_ttl_seconds ?? "default"}s`);
        consola.log(`  SWR:     ${result.entry.cache_swr_seconds ?? "default"}s`);
      });
    });
  },
});
