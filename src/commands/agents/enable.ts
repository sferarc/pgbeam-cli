import { defineCommand } from "citty";
import { consola } from "consola";
import { requireProject, resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";

export default defineCommand({
  meta: {
    name: "enable",
    description: "Re-enable a disabled agent credential",
    docs: {
      longDescription:
        "Re-enable an agent credential that was previously disabled with `pgbeam agents disable`. New connections using it are accepted again, subject to its policy profile.",
      examples: [{ comment: "Re-enable a credential", command: "pgbeam agents enable agt_xxx" }],
      response: "Confirms the credential was enabled.",
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
      await ctx.client.agents.updateAgentCredentialStatus({
        pathParams: { project_id: projectId, agent_id: args.id },
        body: { status: "active" },
      });
      consola.success(`Agent credential ${args.id} enabled`);
    });
  },
});
