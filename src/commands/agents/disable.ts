import { defineCommand } from "citty";
import { consola } from "consola";
import { requireProject, resolveContext } from "../../lib/client.js";
import { confirmDestructive } from "../../lib/confirm.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";

export default defineCommand({
  meta: {
    name: "disable",
    description: "Kill-switch an agent credential (reversible)",
    docs: {
      longDescription:
        "Disable an agent credential as a reversible kill-switch. Live connections using it are dropped within seconds and new connections are rejected until the credential is re-enabled with `pgbeam agents enable`. Unlike `revoke`, this does not permanently destroy the credential. A confirmation prompt is shown unless `--yes` is passed.",
      examples: [
        {
          comment: "Disable a credential (with confirmation)",
          command: "pgbeam agents disable agt_xxx",
        },
        {
          comment: "Disable without confirmation (CI/CD)",
          command: "pgbeam agents disable agt_xxx --yes",
        },
      ],
      response: "Confirms the credential was disabled.",
    },
  },
  args: {
    ...globalArgs,
    id: { type: "positional", description: "Agent credential ID", required: true },
    yes: {
      type: "boolean",
      alias: "y",
      description: "Skip the confirmation prompt (useful for scripts and CI/CD)",
      default: false,
    },
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);
      const projectId = requireProject(ctx);

      await confirmDestructive({
        yes: args.yes,
        action: "Disable",
        message: `Disable agent credential ${args.id}? Live connections are dropped within seconds (reversible with \`pgbeam agents enable\`).`,
      });

      await ctx.client.agents.updateAgentCredentialStatus({
        pathParams: { project_id: projectId, agent_id: args.id },
        body: { status: "disabled" },
      });
      consola.success(`Agent credential ${args.id} disabled`);
    });
  },
});
