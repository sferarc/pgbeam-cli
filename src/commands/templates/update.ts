import { defineCommand } from "citty";
import { consola } from "consola";
import type { QueryTemplateInput } from "pgbeam";
import { optionalArg, requireArg } from "../../lib/args.js";
import { requireProject, resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";
import { output } from "../../lib/output.js";
import { hasRepeatable } from "../../lib/policy.js";
import { collectParams, resolveSql } from "../../lib/query-template.js";

export default defineCommand({
  meta: {
    name: "update",
    description: "Update a query template",
    docs: {
      longDescription:
        "Update an existing query template. Only the fields you pass are changed; every other field is carried over from the stored template. `--param` replaces the whole parameter list, so pass every parameter again in placeholder order, or `--clear-params` for a statement that takes none. The API parses the result again and refuses it if the SQL and the parameters no longer agree.",
      examples: [
        {
          comment: "Withdraw a template without deleting it",
          command: "pgbeam templates update qtp_xxx --enabled=false",
        },
        {
          comment: "Replace the statement and its parameters",
          command:
            "pgbeam templates update qtp_xxx --sql-file open_orders.sql --param customer_id:bigint --param status:text",
        },
        {
          comment: "Show the SQL to agents that list the templates",
          command: "pgbeam templates update qtp_xxx --include-sql",
        },
      ],
      response:
        "Prints a success message confirming the template was updated. With `--json`, returns the full updated template object from the API.",
    },
  },
  args: {
    ...globalArgs,
    id: {
      type: "positional",
      description: "ID of the query template to update",
      required: true,
    },
    name: {
      type: "string",
      description: "Rename the template. Agents invoke it by the new name.",
    },
    sql: {
      type: "string",
      description: "Replace the statement.",
    },
    "sql-file": {
      type: "string",
      description: "Replace the statement from a file, or from stdin with `-`.",
    },
    param: {
      type: "string",
      description:
        "Replace the parameter list. Declare each as name:type or name:type:null, repeated in placeholder order.",
    },
    "clear-params": {
      type: "boolean",
      description: "Remove every declared parameter.",
      default: false,
    },
    description: {
      type: "string",
      description: "Replace the description shown to agents.",
    },
    "include-sql": {
      type: "boolean",
      description: "Show (true) or hide (false) the SQL text to agents that list the templates.",
    },
    enabled: {
      type: "boolean",
      description: "Admit (true) or withdraw (false) the template.",
    },
  },
  async run({ args, rawArgs }) {
    await runCommand(async () => {
      const templateId = requireArg(args.id, "query template ID");
      const paramsGiven = hasRepeatable("param", rawArgs, args.param);
      if (paramsGiven && args["clear-params"]) {
        throw new Error("Use either --param or --clear-params, not both");
      }
      const params = paramsGiven ? collectParams(rawArgs, args.param) : undefined;
      const sql = await resolveSql(args.sql, args["sql-file"]);

      const ctx = resolveContext(args);
      const projectId = requireProject(ctx);
      const pathParams = { project_id: projectId, query_template_id: templateId };

      // PUT replaces the template, so carry over every field the user did not pass.
      const current = await ctx.client.policies.getQueryTemplate({ pathParams });

      const body: QueryTemplateInput = {
        name: optionalArg(args.name) ?? current.name,
        sql: sql ?? current.sql,
        params: args["clear-params"] ? [] : (params ?? current.params),
        description: optionalArg(args.description) ?? current.description,
        include_sql: args["include-sql"] ?? current.include_sql,
        enabled: args.enabled ?? current.enabled,
      };

      const result = await ctx.client.policies.updateQueryTemplate({ pathParams, body });

      output(result, args.json, () => {
        consola.success(`Query template ${templateId} updated.`);
      });
    });
  },
});
