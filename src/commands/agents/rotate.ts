import { defineCommand } from "citty";
import { consola } from "consola";
import { requireProject, resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";
import { type McpClient, parseMcpClient } from "../../lib/mcp-config.js";
import { output } from "../../lib/output.js";
import { printAgentSecrets } from "./secrets.js";

export default defineCommand({
  meta: {
    name: "rotate",
    description: "Rotate an agent credential's secrets",
    docs: {
      longDescription:
        "Generate a new Postgres password and MCP token for an existing credential, keeping its id, username, name, and policy. Connections using the old password are dropped within seconds. The new secrets are shown once and cannot be retrieved again, so update your agent before its next call. A ready-to-paste MCP client config is printed alongside the secrets.",
      examples: [
        { comment: "Rotate a credential's secrets", command: "pgbeam agents rotate agt_xxx" },
        {
          comment: "Rotate and emit a VS Code MCP config",
          command: "pgbeam agents rotate agt_xxx --client vscode",
        },
        {
          comment: "Rotate and capture secrets as JSON",
          command: "pgbeam agents rotate agt_xxx --json",
        },
      ],
      response:
        "Prints the new connection string, MCP URL, MCP token, and a ready-to-paste MCP client config once. With --json, returns the full secrets object.",
    },
  },
  args: {
    ...globalArgs,
    id: { type: "positional", description: "Agent credential ID", required: true },
    client: {
      type: "string",
      description:
        "MCP client to emit config for: claude (default), claude-desktop, cursor, vscode, cline, windsurf, or all",
      default: "claude",
    },
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);
      const projectId = requireProject(ctx);
      const client: McpClient | undefined =
        args.client === "all" ? undefined : parseMcpClient(args.client);

      const result = await ctx.client.agents.rotateAgentCredential({
        pathParams: { project_id: projectId, agent_id: args.id },
      });

      output(result, args.json, () => {
        consola.success(`Agent credential ${result.credential.id} rotated`);
        printAgentSecrets(result, client);
      });
    });
  },
});
