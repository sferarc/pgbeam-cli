import { defineCommand } from "citty";
import { consola } from "consola";
import { parseEnum, parseExpiry } from "../../lib/args.js";
import { requireProject, resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";
import { type McpClient, parseMcpClient } from "../../lib/mcp-config.js";
import { output } from "../../lib/output.js";
import { printAgentSecrets } from "./secrets.js";

const principalTypes = { agent: "agent", human: "human" } as const;

export default defineCommand({
  meta: {
    name: "create",
    description: "Issue a new agent credential",
    docs: {
      longDescription:
        "Issue a scoped Postgres login and hosted MCP token for an AI agent. The connection string and MCP token are shown once and cannot be retrieved again. Store them securely. A ready-to-paste MCP client config (Claude Code, Claude Desktop, Cursor, VS Code, Cline, or Windsurf) is printed alongside the secrets.",
      examples: [
        {
          comment: "Create a credential bound to a policy profile",
          command: 'pgbeam agents create --name "Claude Code" --policy pol_xxx',
        },
        {
          comment: "Create and emit a Cursor MCP config",
          command: "pgbeam agents create --name agent --policy pol_xxx --client cursor",
        },
        {
          comment: "Create a credential that expires in 30 days",
          command: "pgbeam agents create --name agent --policy pol_xxx --expires 30d",
        },
        {
          comment: "Mint a human-operator credential",
          command:
            'pgbeam agents create --name "Data analyst" --policy pol_xxx --principal-type human',
        },
        {
          comment: "Create and capture secrets as JSON",
          command: "pgbeam agents create --name ci --policy pol_xxx --json",
        },
      ],
      response:
        "Prints the connection string, MCP URL, MCP token, and a ready-to-paste MCP client config once. With --json, returns the full secrets object.",
    },
  },
  args: {
    ...globalArgs,
    name: {
      type: "string",
      description: "Human-readable label for the credential",
      required: true,
    },
    policy: { type: "string", description: "Policy profile ID to enforce", required: true },
    client: {
      type: "string",
      description:
        "MCP client to emit config for: claude (default), claude-desktop, cursor, vscode, cline, windsurf, or all",
      default: "claude",
    },
    expires: {
      type: "string",
      description:
        "Credential lifetime: a duration like 30d/12h/90m, or an absolute ISO 8601 timestamp. Omit for no expiry.",
    },
    "principal-type": {
      type: "string",
      description:
        "Whether the credential represents an autonomous agent (default) or a human operator: agent or human",
    },
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);
      const projectId = requireProject(ctx);
      const client: McpClient | undefined =
        args.client === "all" ? undefined : parseMcpClient(args.client);
      const expiresAt = typeof args.expires === "string" ? parseExpiry(args.expires) : undefined;
      const principalType = args["principal-type"]
        ? parseEnum(args["principal-type"], principalTypes, "principal-type")
        : undefined;

      const result = await ctx.client.agents.createAgentCredential({
        pathParams: { project_id: projectId },
        body: {
          name: args.name,
          policy_profile_id: args.policy,
          ...(principalType ? { principal_type: principalType } : {}),
          ...(expiresAt ? { expires_at: expiresAt } : {}),
        },
      });

      output(result, args.json, () => {
        consola.success(`Agent credential created: ${result.credential.id}`);
        printAgentSecrets(result, client);
      });
    });
  },
});
