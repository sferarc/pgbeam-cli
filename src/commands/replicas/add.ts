import { input, select } from "@inquirer/prompts";
import { defineCommand } from "citty";
import { consola } from "consola";
import { parseEnum, parseNumber, requireArg, sslModes } from "../../lib/args.js";
import { resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";
import { output } from "../../lib/output.js";

export default defineCommand({
  meta: {
    name: "add",
    description: "Add a read replica",
    docs: {
      longDescription:
        "Add a read replica to a database connection. PgBeam can route read-only queries to replicas for improved performance and load distribution. Without the `--host` flag, the command prompts for the replica hostname interactively.",
      examples: [
        {
          comment: "Add a replica interactively",
          command: "pgbeam replicas add --database-id db_xxx",
        },
        {
          comment: "Add a replica with all flags",
          command:
            "pgbeam replicas add --database-id db_xxx --host replica.example.com --port 5432 --ssl-mode require",
        },
      ],
      response: "Prints the new replica ID. With `--json`, returns the full replica object.",
    },
  },
  args: {
    ...globalArgs,
    "database-id": {
      type: "string",
      description: "ID of the database to add the replica to",
      required: true,
    },
    host: {
      type: "string",
      description: "Hostname or IP address of the replica server",
    },
    port: {
      type: "string",
      description: "Port number of the replica server",
      default: "5432",
    },
    "ssl-mode": {
      type: "string",
      description: "SSL connection mode: disable, require, verify-ca, or verify-full",
    },
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);
      const databaseId = requireArg(args["database-id"], "database-id");

      const host = args.host ?? (await input({ message: "Replica host:" }));
      const port = parseNumber(args.port, "port");
      const sslMode = args["ssl-mode"]
        ? parseEnum(args["ssl-mode"], sslModes, "ssl-mode")
        : await select({
            message: "SSL mode:",
            choices: [
              { name: "require", value: sslModes.require },
              { name: "verify-full", value: sslModes["verify-full"] },
              { name: "disable", value: sslModes.disable },
            ],
          });

      const result = await ctx.client.projects.createReplica({
        pathParams: { database_id: databaseId },
        body: {
          host,
          port,
          ssl_mode: sslMode,
        },
      });

      output(result, args.json, () => {
        consola.success(`Replica added: ${result.id}`);
      });
    });
  },
});
