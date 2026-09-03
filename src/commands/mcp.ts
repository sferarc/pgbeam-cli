import { defineCommand } from "citty";
import { globalArgs } from "../lib/flags.js";

export default defineCommand({
  meta: {
    name: "mcp",
    description: "Start MCP server (stdio transport)",
    icon: "Bot",
    docs: {
      longDescription:
        "Start a Model Context Protocol (MCP) server using stdio transport. This allows AI coding assistants like Claude Code, Cursor, and other MCP-compatible clients to manage PgBeam projects, databases, and cache rules directly. Rather than one tool per endpoint, the server exposes three meta-tools — search_endpoints, describe_endpoint, and call_endpoint — so the agent discovers and invokes the API it needs without loading dozens of tool schemas up front.",
      examples: [
        { comment: "Start the MCP server", command: "pgbeam mcp" },
        {
          comment: "Register it in .mcp.json (Claude Code, Cursor, VS Code)",
          command: `{ "mcpServers": { "pgbeam": { "command": "pgbeam", "args": ["mcp"] } } }`,
        },
      ],
      response:
        "Starts the MCP server and listens for JSON-RPC messages on stdin/stdout. The server runs until the process is terminated. No human-readable output is produced — all communication is via the MCP protocol.",
    },
  },
  args: {
    ...globalArgs,
  },
  async run({ args }) {
    const { startMcpServer } = await import("../mcp/server.js");
    await startMcpServer(args);
  },
});
