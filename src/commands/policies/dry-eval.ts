import { defineCommand } from "citty";
import { consola } from "consola";
import type { DryEvalInput } from "pgbeam";
import { requireProject, resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";
import { output } from "../../lib/output.js";
import { readDraftPolicyFile } from "../../lib/policy.js";

export default defineCommand({
  meta: {
    name: "dry-eval",
    description: "Dry-eval a SQL statement against a policy",
    docs: {
      longDescription:
        "Evaluate a single SQL statement against a policy and print the decision the proxy would make: allow, block, mask, or row-filter. Supply exactly one of `--policy` (an existing saved policy ID) or `--draft` (a JSON file describing an unsaved draft policy). The evaluation reuses the data plane's own policy engine, so a what-if verdict matches real enforcement. Stateful checks a single-statement preview cannot model (per-region budgets, approvals, write routing) are reported as informational notes.",
      examples: [
        {
          comment: "Evaluate against a saved policy",
          command: 'pgbeam policies dry-eval --policy pol_xxx --sql "SELECT email FROM users"',
        },
        {
          comment: "Evaluate against a draft policy from a file",
          command: 'pgbeam policies dry-eval --draft ./policy.json --sql "DELETE FROM users"',
        },
        {
          comment: "Get the full verdict as JSON",
          command: 'pgbeam policies dry-eval --policy pol_xxx --sql "SELECT 1" --json',
        },
      ],
      response:
        "Prints the verdict (allow/block/mask/row-filter), the rule, reason, any masked columns, injected row-filter predicate, and informational notes. With --json, returns the full result object.",
    },
  },
  args: {
    ...globalArgs,
    sql: { type: "string", description: "The single SQL statement to evaluate", required: true },
    policy: { type: "string", description: "ID of an existing saved policy to evaluate against" },
    draft: {
      type: "string",
      description: "Path to a JSON file with a draft policy body to evaluate against",
    },
  },
  async run({ args }) {
    await runCommand(async () => {
      // Client-side validation (flag shape, draft file existence, parse, and
      // schema) runs before auth resolution, so a missing draft file reports
      // itself rather than an unrelated "Not authenticated" error.
      if (!args.policy && !args.draft) {
        consola.error(
          "Supply exactly one of --policy (a saved policy ID) or --draft (a JSON file).",
        );
        process.exit(1);
      }
      if (args.policy && args.draft) {
        consola.error("--policy and --draft are mutually exclusive. Pass only one.");
        process.exit(1);
      }

      const body: DryEvalInput = { sql: args.sql };
      if (args.policy) {
        body.policy_id = args.policy;
      } else if (args.draft) {
        body.policy = readDraftPolicyFile(args.draft) as DryEvalInput["policy"];
      }

      const ctx = resolveContext(args);
      const projectId = requireProject(ctx);

      const result = await ctx.client.policies.dryEvalPolicy({
        pathParams: { project_id: projectId },
        body,
      });

      output(result, args.json, () => {
        const lines = [
          `Verdict: ${result.verdict}`,
          `Rule:    ${result.rule}`,
          `Reason:  ${result.reason}`,
        ];
        if (result.hint) {
          lines.push(`Hint:    ${result.hint}`);
        }
        if (result.masked_columns?.length) {
          lines.push(
            `Masked:  ${result.masked_columns.map((c) => `${c.column} (${c.kind})`).join(", ")}`,
          );
        }
        if (result.row_filter_predicate) {
          lines.push(`Filter:  ${result.row_filter_predicate}`);
        }
        if (result.rewritten_sql) {
          lines.push(`Rewritten: ${result.rewritten_sql}`);
        }
        if (result.notes?.length) {
          lines.push("Notes:");
          for (const note of result.notes) {
            lines.push(`  - ${note}`);
          }
        }
        consola.log(lines.join("\n"));
      });
    });
  },
});
