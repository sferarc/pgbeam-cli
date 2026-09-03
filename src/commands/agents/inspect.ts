import { defineCommand } from "citty";
import { consola } from "consola";
import { buildCapabilityCard, formatCapabilityCard } from "../../lib/capability-card.js";
import { requireProject, resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";
import { output } from "../../lib/output.js";

export default defineCommand({
  meta: {
    name: "inspect",
    description: "Show what an agent credential can actually do",
    docs: {
      longDescription:
        "Fetch an agent credential together with the policy profile attached to it and print one capability card: whether the credential can connect at all, which statement kinds it can run, which relations it can reach, which columns come back masked, its budgets and caps, and how its writes are handled. The card resolves the two records against each other the way the proxy does, so it reports the effective answer rather than the raw fields: a read-only credential that lists `update` in its statement allowlist is still shown as blocked, because access_mode is a ceiling the allowlist cannot lift. The same static checks `pgbeam policies lint` runs are appended, so a credential attached to a risky policy says so here. Read-only: it fetches two records and computes the rest offline. Use `pgbeam agents show` for the raw credential record.",
      examples: [
        {
          comment: "Show a credential's capability card",
          command: "pgbeam agents inspect agt_xxx",
        },
        {
          comment: "Capture the card as JSON",
          command: "pgbeam agents inspect agt_xxx --json",
        },
      ],
      response:
        "Prints the capability card: credential state, effective statement kinds, reachable relations, masked columns, row filters, budgets, write handling, the non-configurable safety floor, and any policy lint findings. With --json, returns the full card object including a per-kind statement verdict list and the lint findings with their summary.",
    },
  },
  args: {
    ...globalArgs,
    id: { type: "positional", description: "Agent credential ID", required: true },
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);
      const projectId = requireProject(ctx);

      const credential = await ctx.client.agents.getAgentCredential({
        pathParams: { project_id: projectId, agent_id: args.id },
      });
      // The policy is what makes this a capability card rather than an alias for
      // `agents show`; a credential with no policy attached is not a shape the
      // API produces, so an absent id is an error rather than a partial card.
      if (!credential.policy_profile_id) {
        throw new Error(
          `Agent credential ${credential.id} has no policy profile attached, so its capability cannot be resolved.`,
        );
      }
      const policy = await ctx.client.policies.getPolicyProfile({
        pathParams: { project_id: projectId, policy_id: credential.policy_profile_id },
      });

      const card = buildCapabilityCard(credential, policy);

      output(card, args.json, () => {
        for (const line of formatCapabilityCard(card)) {
          consola.log(line);
        }
      });
    });
  },
});
