import { defineCommand } from "citty";
import { consola } from "consola";
import { optionalArg } from "../../lib/args.js";
import { requireOrg, resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";
import { output } from "../../lib/output.js";

export default defineCommand({
  meta: {
    name: "spend-limit",
    description: "Set or remove the organization monthly spend cap",
    docs: {
      longDescription:
        "Set a monthly USD spend cap for the active organization, or remove it with `--remove`. When the cap is reached, usage-based features are paused until the next billing period. Pass the amount in dollars (e.g. 250 for $250/mo).",
      examples: [
        { comment: "Set the cap to $250/mo", command: "pgbeam analytics spend-limit 250" },
        {
          comment: "Set the cap for a specific org",
          command: "pgbeam analytics spend-limit 500 --org org_xxx",
        },
        { comment: "Remove the cap", command: "pgbeam analytics spend-limit --remove" },
      ],
      response:
        "Confirms the new spend cap (or its removal) and prints the current value. With `--json`, returns the updated organization plan object.",
    },
  },
  args: {
    ...globalArgs,
    amount: {
      type: "positional",
      description: "Monthly spend cap in USD (e.g. 250). Omit when using --remove.",
      required: false,
    },
    remove: {
      type: "boolean",
      description: "Remove the spend cap entirely",
      default: false,
    },
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);
      const orgId = requireOrg(ctx);

      const rawAmount = optionalArg(args.amount);
      let spendLimit: number | null;
      if (args.remove) {
        spendLimit = null;
      } else {
        if (rawAmount === undefined) {
          throw new Error("Provide a spend cap amount in USD, or use --remove to clear it.");
        }
        const parsed = Number(rawAmount);
        if (!Number.isFinite(parsed) || parsed < 0) {
          throw new Error(
            `Invalid amount: ${rawAmount}. Provide a non-negative number of dollars.`,
          );
        }
        spendLimit = parsed;
      }

      const result = await ctx.client.analytics.updateSpendLimit({
        pathParams: { org_id: orgId },
        body: { spend_limit: spendLimit },
      });

      output(result, args.json, () => {
        if (spendLimit === null) {
          consola.success("Spend cap removed.");
        } else {
          consola.success(`Spend cap set to $${spendLimit.toFixed(2)}/mo.`);
        }
      });
    });
  },
});
