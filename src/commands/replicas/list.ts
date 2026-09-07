import { defineCommand } from "citty";
import { requireArg } from "../../lib/args.js";
import { resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";
import { output, outputTable } from "../../lib/output.js";

export default defineCommand({
  meta: {
    name: "list",
    description: "List read replicas",
    docs: {
      longDescription:
        "List all read replicas configured for a database. Shows each replica's ID, host, port, and SSL mode.",
      examples: [
        {
          comment: "List replicas for a database",
          command: "pgbeam replicas list --database-id db_xxx",
        },
        {
          comment: "List replicas as JSON",
          command: "pgbeam replicas list --database-id db_xxx --json",
        },
      ],
      response:
        "Displays a table with columns: ID, Host, Port, and SSL. With `--json`, returns the full replica list from the API.",
    },
  },
  args: {
    ...globalArgs,
    "database-id": {
      type: "string",
      description: "ID of the database whose replicas to list",
      required: true,
    },
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);
      const databaseId = requireArg(args["database-id"], "database-id");

      const firstPage = await ctx.client.projects.listReplicas({
        pathParams: { database_id: databaseId },
        queryParams: { page_size: 100 },
      });
      const replicas = [...firstPage.replicas];
      let pageToken = firstPage.next_page_token;
      while (pageToken) {
        const nextPage = await ctx.client.projects.listReplicas({
          pathParams: { database_id: databaseId },
          queryParams: { page_size: 100, page_token: pageToken },
        });
        replicas.push(...nextPage.replicas);
        pageToken = nextPage.next_page_token;
      }
      const result = { ...firstPage, replicas, next_page_token: null };

      output(result, args.json, () => {
        outputTable(
          replicas.map((r) => ({
            id: r.id,
            host: r.host,
            port: r.port,
            ssl: r.ssl_mode,
          })),
          [
            { key: "id", label: "ID" },
            { key: "host", label: "Host" },
            { key: "port", label: "Port" },
            { key: "ssl", label: "SSL" },
          ],
        );
      });
    });
  },
});
