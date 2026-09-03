import { defineCommand } from "citty";
import { consola } from "consola";
import type { UpdateDatabaseBody } from "pgbeam";
import { parseEnum, parseNumber, poolModes, requireArg } from "../../lib/args.js";
import { requireProject, resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";
import { output } from "../../lib/output.js";

export default defineCommand({
  meta: {
    name: "update",
    description: "Update database settings",
    docs: {
      longDescription:
        "Update the configuration of an existing database connection. Supports changing the display name, cache settings (enable/disable, TTL), and connection pool settings (mode, size). At least one update flag must be provided. Current settings are preserved for any flag not specified.",
      examples: [
        {
          comment: "Enable caching with a 60-second TTL",
          command: "pgbeam db update db_xxx --cache-enabled --cache-ttl 60",
        },
        {
          comment: "Switch to transaction pooling",
          command: "pgbeam db update db_xxx --pool-mode transaction",
        },
        {
          comment: "Adjust pool size limits",
          command: "pgbeam db update db_xxx --pool-size 20 --min-pool-size 5",
        },
        {
          comment: "Rename the database",
          command: "pgbeam db update db_xxx --name production-primary",
        },
      ],
      response:
        "Prints a success message confirming the database was updated. With `--json`, returns the updated database object.",
    },
  },
  args: {
    ...globalArgs,
    id: {
      type: "positional",
      description: "ID of the database to update",
      required: true,
    },
    name: {
      type: "string",
      description: "New display name for the database",
    },
    "cache-enabled": {
      type: "boolean",
      description: "Enable or disable query result caching for this database",
    },
    "cache-ttl": {
      type: "string",
      description: "Time-to-live for cached query results, in seconds",
    },
    "pool-mode": {
      type: "string",
      description: "Connection pool mode: transaction, session, or statement",
    },
    "pool-size": {
      type: "string",
      description: "Maximum number of connections in the pool (default: 10)",
    },
    "min-pool-size": {
      type: "string",
      description: "Minimum number of idle connections maintained in the pool (default: 1)",
    },
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);
      const projectId = requireProject(ctx);
      const databaseId = requireArg(args.id, "database ID");

      // Fetch current database to merge with user-provided values
      const current = await ctx.client.databases.getDatabase({
        pathParams: { project_id: projectId, database_id: databaseId },
      });

      const body: UpdateDatabaseBody = {};
      if (args.name) body.name = args.name;
      if (args["cache-enabled"] !== undefined || args["cache-ttl"]) {
        body.cache_config = {
          ...current.cache_config,
          ...(args["cache-enabled"] !== undefined ? { enabled: args["cache-enabled"] } : {}),
          ...(args["cache-ttl"] != null
            ? { ttl_seconds: parseNumber(args["cache-ttl"], "cache-ttl") }
            : {}),
        };
      }
      if (args["pool-mode"] || args["pool-size"] != null || args["min-pool-size"] != null) {
        body.pool_config = {
          ...current.pool_config,
          ...(args["pool-mode"]
            ? { pool_mode: parseEnum(args["pool-mode"], poolModes, "pool-mode") }
            : {}),
          ...(args["pool-size"] != null
            ? { pool_size: parseNumber(args["pool-size"], "pool-size") }
            : {}),
          ...(args["min-pool-size"] != null
            ? { min_pool_size: parseNumber(args["min-pool-size"], "min-pool-size") }
            : {}),
        };
      }

      if (Object.keys(body).length === 0) {
        consola.error(
          "Nothing to update. Pass --name, --cache-enabled, --cache-ttl, or --pool-mode.",
        );
        process.exit(1);
      }

      const result = await ctx.client.databases.updateDatabase({
        pathParams: { project_id: projectId, database_id: databaseId },
        body,
      });

      output(result, args.json, () => {
        consola.success(`Database ${databaseId} updated.`);
      });
    });
  },
});
