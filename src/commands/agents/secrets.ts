import { consola } from "consola";
import type { AgentCredentialSecrets } from "pgbeam";
import {
  buildMcpConfigBlocks,
  claudeMcpAddCommand,
  globalPathHint,
  type McpClient,
} from "../../lib/mcp-config.js";

/**
 * Print the reveal-once secrets for an agent credential (connection string, MCP
 * URL, MCP token) followed by ready-to-paste MCP client config.
 *
 * Shared by `agents create` and `agents rotate` so both emit identical output.
 * When `client` is undefined, config for all clients is printed.
 */
export function printAgentSecrets(secrets: AgentCredentialSecrets, client?: McpClient): void {
  consola.warn("Store these now — they will not be shown again:");
  consola.box(
    [
      `Connection string:\n  ${secrets.connection_string}`,
      `MCP URL:\n  ${secrets.mcp_url}`,
      `MCP token:\n  ${secrets.mcp_token}`,
    ].join("\n\n"),
  );

  const blocks = buildMcpConfigBlocks(secrets.mcp_url, secrets.mcp_token, client);
  for (const block of blocks) {
    consola.box({
      title: `${block.label} — add to ${block.file}`,
      message: block.config,
    });
    if (block.scope === "global") {
      consola.info(globalPathHint(block));
    }
  }

  consola.info(
    `Or, with the Claude Code CLI:\n  ${claudeMcpAddCommand(secrets.mcp_url, secrets.mcp_token)}`,
  );
}
