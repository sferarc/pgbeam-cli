import { defineCommand } from "citty";
import { resolveContext } from "../lib/client.js";
import { runCommand } from "../lib/errors.js";
import { globalArgs } from "../lib/flags.js";
import { output, outputTable } from "../lib/output.js";

export default defineCommand({
  meta: {
    name: "plans",
    description: "List available plans",
    docs: {
      longDescription:
        "List all available PgBeam subscription plans with their pricing and resource limits. Use this to compare plans before upgrading or to check what limits apply to each tier.",
      examples: [
        { comment: "List all plans", command: "pgbeam analytics plans" },
        { comment: "List plans as JSON", command: "pgbeam analytics plans --json" },
      ],
      response:
        "Displays a table with columns: Plan, Label, Price, Projects, Databases, Connections, and Queries/Day. With `--json`, returns the full plans array from the API.",
    },
  },
  args: {
    ...globalArgs,
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);

      const result = await ctx.client.analytics.listPlans();

      output(result, args.json, () => {
        outputTable(
          result.plans.map((p) => ({
            name: p.name,
            label: p.label,
            price: `$${p.monthly_price}/mo`,
            projects: p.limits.max_projects,
            databases: p.limits.max_databases,
            connections: p.limits.max_connections,
            queries_day:
              p.limits.queries_per_day === 0
                ? "unlimited"
                : p.limits.queries_per_day.toLocaleString(),
          })),
          [
            { key: "name", label: "Plan" },
            { key: "label", label: "Label" },
            { key: "price", label: "Price" },
            { key: "projects", label: "Projects" },
            { key: "databases", label: "Databases" },
            { key: "connections", label: "Connections" },
            { key: "queries_day", label: "Queries/Day" },
          ],
        );
      });
    });
  },
});
