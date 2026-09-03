import { defineCommand } from "citty";
import { consola } from "consola";
import { requireArg } from "../../lib/args.js";
import { resolveContext } from "../../lib/client.js";
import { confirmDestructive } from "../../lib/confirm.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";

export default defineCommand({
  meta: {
    name: "delete",
    description: "Remove a read replica",
    docs: {
      longDescription:
        "Remove a read replica from a database. PgBeam will stop routing queries to this replica. The upstream replica server is not affected. A confirmation prompt is shown unless `--yes` is passed.",
      examples: [
        {
          comment: "Delete a replica (with confirmation)",
          command: "pgbeam replicas delete rep_xxx --database-id db_xxx",
        },
        {
          comment: "Delete without confirmation",
          command: "pgbeam replicas delete rep_xxx --database-id db_xxx --yes",
        },
      ],
      response: "Prints a success message confirming the replica was deleted.",
    },
  },
  args: {
    ...globalArgs,
    "database-id": {
      type: "string",
      description: "ID of the database that owns the replica",
      required: true,
    },
    id: {
      type: "positional",
      description: "ID of the replica to remove",
      required: true,
    },
    yes: {
      type: "boolean",
      alias: "y",
      description: "Skip the confirmation prompt",
      default: false,
    },
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);
      const databaseId = requireArg(args["database-id"], "database-id");
      const replicaId = requireArg(args.id, "replica ID");

      await confirmDestructive({
        yes: args.yes,
        action: "Delete",
        message: `Delete replica ${replicaId}? This cannot be undone.`,
      });

      await ctx.client.projects.deleteReplica({
        pathParams: {
          database_id: databaseId,
          replica_id: replicaId,
        },
      });

      consola.success(`Replica ${replicaId} deleted.`);
    });
  },
});
