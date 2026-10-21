import { defineCommand } from "citty";
import { consola } from "consola";
import type { QueryTemplateInput } from "pgbeam";
import { optionalArg, requireArg } from "../../lib/args.js";
import { requireProject, resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";
import { output, sanitizeForTerminal } from "../../lib/output.js";
import { collectParams, describeParams, resolveSql } from "../../lib/query-template.js";

export default defineCommand({
  meta: {
    name: "create",
    description: "Create a query template",
    docs: {
      longDescription:
        "Add a named, parameterized statement to the linked project. A template admits a statement for a policy profile that runs templates only; it never grants access, and a statement it admits still meets the credential's whole policy. Write placeholders as $1, $2 and so on, and declare one `--param name:type` for each, in placeholder order; append `:null` to let an argument be omitted. The API parses the SQL on write and refuses anything that is not exactly one SELECT, INSERT, UPDATE or DELETE whose placeholders match the declared parameters.",
      examples: [
        {
          comment: "Create a template with one parameter",
          command:
            "pgbeam templates create open_orders --sql \"SELECT id, total FROM orders WHERE customer_id = \\$1 AND status = 'open'\" --param customer_id:bigint",
        },
        {
          comment: "Read a multi-line statement from a file and describe it for agents",
          command:
            'pgbeam templates create orders_since --sql-file orders_since.sql --param customer_id:bigint --param since:timestamptz:null --description "Orders for one customer, optionally since a date"',
        },
        {
          comment: "Save a template withdrawn, so it admits nothing yet",
          command: "pgbeam templates create recent_signups --sql-file signups.sql --disabled",
        },
      ],
      response:
        "Prints the new template's ID, its statement kind and its parameters. With `--json`, returns the full template object from the API.",
    },
  },
  args: {
    ...globalArgs,
    name: {
      type: "positional",
      description: "Name an agent invokes the template by: a lower-case identifier.",
      required: true,
    },
    sql: {
      type: "string",
      description: "The statement, with parameters as $1, $2 and so on.",
    },
    "sql-file": {
      type: "string",
      description: "Read the statement from a file, or from stdin with `-`.",
    },
    param: {
      type: "string",
      description:
        "Declare a parameter as name:type or name:type:null. Repeat once per placeholder, in order. Types: text, integer, bigint, double precision, numeric, boolean, uuid, date, timestamptz, jsonb.",
    },
    description: {
      type: "string",
      description: "What the template is for, shown to an agent that lists the templates.",
    },
    "include-sql": {
      type: "boolean",
      description: "Show the SQL text to an agent that lists the templates. Off by default.",
      default: false,
    },
    disabled: {
      type: "boolean",
      description: "Save the template withdrawn, so it admits nothing until enabled.",
      default: false,
    },
  },
  async run({ args, rawArgs }) {
    await runCommand(async () => {
      const name = requireArg(args.name, "template name");
      const params = collectParams(rawArgs, args.param);
      const sql = await resolveSql(args.sql, args["sql-file"]);
      if (sql === undefined) {
        throw new Error("Pass the statement with --sql or --sql-file");
      }

      const ctx = resolveContext(args);
      const projectId = requireProject(ctx);

      const body: QueryTemplateInput = {
        name,
        sql,
        params,
        include_sql: args["include-sql"],
        enabled: !args.disabled,
      };
      const description = optionalArg(args.description);
      if (description !== undefined) body.description = description;

      const result = await ctx.client.policies.createQueryTemplate({
        pathParams: { project_id: projectId },
        body,
      });

      output(result, args.json, () => {
        consola.success(`Query template created: ${result.id}`);
        consola.log(`  Name: ${sanitizeForTerminal(result.name)}`);
        consola.log(`  Kind: ${result.statement_kind ?? "unknown"}`);
        consola.log(`  Params: ${sanitizeForTerminal(describeParams(result.params))}`);
        if (!result.enabled) consola.log("  Disabled: it admits nothing until enabled.");
      });
    });
  },
});
