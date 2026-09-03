import { defineCommand } from "citty";
import { consola } from "consola";
import { requireOrg, resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";
import { formatDate, output } from "../../lib/output.js";

export default defineCommand({
  meta: {
    name: "plan",
    description: "Show organization plan details",
    docs: {
      longDescription:
        "Display the subscription plan and resource limits for the active organization. Shows the plan name, subscription status, billing period, and limits for projects, databases, connections, and queries.",
      examples: [
        { comment: "Show plan details", command: "pgbeam orgs plan" },
        {
          comment: "Show plan details for a specific org",
          command: "pgbeam orgs plan --org org_xxx",
        },
        { comment: "Get plan details as JSON", command: "pgbeam orgs plan --json" },
      ],
      response:
        "Displays the organization ID, plan name, subscription status, period end date, and a breakdown of limits (projects, databases, connections, queries/day, queries/sec). With `--json`, returns the full plan object.",
    },
  },
  args: {
    ...globalArgs,
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);
      const orgId = requireOrg(ctx);

      const result = await ctx.client.analytics.getOrganizationPlan({
        pathParams: { org_id: orgId },
      });

      output(result, args.json, () => {
        consola.log(`Organization: ${result.org_id}`);
        consola.log(`Plan:         ${result.plan}`);
        consola.log(`Status:       ${result.subscription_status ?? "none"}`);
        consola.log(`Enabled:      ${result.enabled ?? true}`);
        if (result.current_period_end) {
          consola.log(`Period ends:  ${formatDate(result.current_period_end)}`);
        }
        consola.log(`\nLimits:`);
        consola.log(`  Projects:     ${result.limits.max_projects}`);
        consola.log(`  Databases:    ${result.limits.max_databases}`);
        consola.log(`  Connections:  ${result.limits.max_connections}`);
        consola.log(
          `  Queries/day:  ${result.limits.queries_per_day === 0 ? "unlimited" : result.limits.queries_per_day.toLocaleString()}`,
        );
        consola.log(`  Queries/sec:  ${result.limits.queries_per_second}`);
      });
    });
  },
});
