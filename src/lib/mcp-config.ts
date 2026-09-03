/**
 * Builds ready-to-paste MCP client configuration for PgBeam's hosted
 * agent-database MCP endpoint.
 *
 * The `claude`, `cursor` and `vscode` shapes MUST stay byte-identical to the
 * dashboard credential-reveal dialog
 * (`frontend/apps/dashboard/lib/mcp-client-config.ts`, `mcpClientConfig`) so the
 * CLI and dashboard emit the same config for the same URL + token. Clients the
 * dashboard does not offer yet (`claude-desktop`, `cline`, `windsurf`) are
 * CLI-only; do not change the three shared shapes without changing the dashboard
 * in the same commit.
 *
 * Every shape here is verified against the client's own schema or published
 * install docs, because these strings get pasted into an editor and submitted to
 * client catalogs. Do not add a client on a guess.
 */

/**
 * Supported MCP clients the CLI can emit config for.
 *
 * `claude`, `cursor` and `vscode` come first, in their original order, so the
 * `--client all` output of the clients that already shipped stays put.
 */
export const mcpClients = [
  "claude",
  "claude-desktop",
  "cursor",
  "vscode",
  "cline",
  "windsurf",
] as const;

export type McpClient = (typeof mcpClients)[number];

/** Human-readable client labels (matches the dashboard toggle group). */
const MCP_CLIENT_LABELS: Record<McpClient, string> = {
  claude: "Claude Code",
  "claude-desktop": "Claude Desktop",
  cursor: "Cursor",
  vscode: "VS Code",
  cline: "Cline",
  windsurf: "Windsurf",
};

/**
 * Per-client config file the snippet should be added to. For project-scoped
 * clients this is relative to the user's project root and mirrors the
 * dashboard's `MCP_CLIENT_FILES`. For machine-scoped clients it is the bare file
 * name, whose location is listed in `MCP_CLIENT_GLOBAL_PATHS`.
 */
export const MCP_CLIENT_FILES: Record<McpClient, string> = {
  claude: ".mcp.json",
  "claude-desktop": "claude_desktop_config.json",
  cursor: ".cursor/mcp.json",
  vscode: ".vscode/mcp.json",
  cline: "cline_mcp_settings.json",
  windsurf: "mcp_config.json",
};

/**
 * Clients whose config file lives at one fixed location per machine instead of
 * in the project. That single file holds every MCP server the user has, so
 * `--write` must not overwrite it: the entry has to be merged in by hand.
 *
 * Claude Desktop paths per the MCP docs
 * (modelcontextprotocol.io/docs/develop/connect-local-servers). Claude Desktop
 * ships on macOS and Windows only, so those are the only paths listed.
 *
 * Cline keeps its settings in the VS Code extension's global storage, so the path
 * changes in a VS Code fork; the in-app "Configure MCP Servers" button is the
 * reliable route. Windsurf paths per its published install docs.
 */
export const MCP_CLIENT_GLOBAL_PATHS: Partial<Record<McpClient, readonly string[]>> = {
  "claude-desktop": [
    "macOS: ~/Library/Application Support/Claude/claude_desktop_config.json",
    "Windows: %APPDATA%\\Claude\\claude_desktop_config.json",
  ],
  cline: [
    "In Cline: MCP Servers, then Configure MCP Servers",
    "macOS: ~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json",
    "Linux: ~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json",
    "Windows: %APPDATA%\\Code\\User\\globalStorage\\saoudrizwan.claude-dev\\settings\\cline_mcp_settings.json",
  ],
  windsurf: [
    "macOS and Linux: ~/.codeium/windsurf/mcp_config.json",
    "Windows: %USERPROFILE%\\.codeium\\windsurf\\mcp_config.json",
  ],
};

/**
 * Env var the Claude Desktop bridge reads the bearer header from.
 *
 * `mcp-remote` supports `--header "Authorization: Bearer <token>"`, but Claude
 * Desktop on Windows (and Cursor) does not escape spaces inside `args` when it
 * invokes `npx`, which mangles the value. The documented workaround is a
 * space-free `--header Authorization:${VAR}` with the value passed via `env`,
 * so that is what we emit: it works on every platform.
 */
const CLAUDE_DESKTOP_AUTH_ENV = "PGBEAM_AUTH_HEADER";

/** Parse a `--client` flag value, throwing on an unknown client. */
export function parseMcpClient(value: string): McpClient {
  if ((mcpClients as readonly string[]).includes(value)) {
    return value as McpClient;
  }
  throw new Error(`Invalid client: "${value}". Allowed: ${mcpClients.join(", ")}, all.`);
}

/**
 * Build a ready-to-paste MCP client config (pretty-printed JSON) for the given
 * hosted URL + bearer token.
 *
 * - Claude Code / Cursor: `{ mcpServers: { pgbeam: { url, headers } } }`
 * - VS Code: `{ servers: { pgbeam: { type: "http", url, headers } } }`
 * - Claude Desktop: an `mcp-remote` stdio bridge, because its config file takes
 *   local `command`/`args` servers only and cannot address a remote URL.
 * - Cline: `type: "streamableHttp"` is required. Cline's schema makes it
 *   optional but defaults to SSE when absent, which 405s against a
 *   streamable-HTTP endpoint.
 * - Windsurf: keys a remote server off `serverUrl`, not `url`, and infers the
 *   transport from it.
 */
export function mcpClientConfig(client: McpClient, url: string, token: string): string {
  const headers = { Authorization: `Bearer ${token}` };
  const server = { url, headers };
  switch (client) {
    case "claude":
    case "cursor":
      return JSON.stringify({ mcpServers: { pgbeam: server } }, null, 2);
    case "vscode":
      return JSON.stringify({ servers: { pgbeam: { type: "http", ...server } } }, null, 2);
    case "claude-desktop":
      return JSON.stringify(
        {
          mcpServers: {
            pgbeam: {
              command: "npx",
              args: [
                "-y",
                "mcp-remote",
                url,
                "--header",
                `Authorization:\${${CLAUDE_DESKTOP_AUTH_ENV}}`,
              ],
              env: { [CLAUDE_DESKTOP_AUTH_ENV]: `Bearer ${token}` },
            },
          },
        },
        null,
        2,
      );
    case "cline":
      return JSON.stringify(
        { mcpServers: { pgbeam: { type: "streamableHttp", ...server } } },
        null,
        2,
      );
    case "windsurf":
      return JSON.stringify({ mcpServers: { pgbeam: { serverUrl: url, headers } } }, null, 2);
  }
}

/**
 * The `claude mcp add` one-liner equivalent of the Claude Code config, so users
 * can wire up the endpoint without hand-editing `.mcp.json`.
 */
export function claudeMcpAddCommand(url: string, token: string): string {
  return `claude mcp add --transport http pgbeam ${url} --header "Authorization: Bearer ${token}"`;
}

interface McpConfigBlockBase {
  client: McpClient;
  label: string;
  file: string;
  config: string;
}

/**
 * One client's config, discriminated by where its file lives: `project` files
 * can be written for the user, `global` files must be merged by hand and carry
 * the per-OS locations to print.
 */
export type McpConfigBlock =
  | (McpConfigBlockBase & { scope: "project" })
  | (McpConfigBlockBase & { scope: "global"; paths: readonly string[] });

/** Build the config block(s) for one client or, when `client` is undefined, all of them. */
export function buildMcpConfigBlocks(
  url: string,
  token: string,
  client?: McpClient,
): McpConfigBlock[] {
  const targets = client ? [client] : [...mcpClients];
  return targets.map((c) => {
    const base: McpConfigBlockBase = {
      client: c,
      label: MCP_CLIENT_LABELS[c],
      file: MCP_CLIENT_FILES[c],
      config: mcpClientConfig(c, url, token),
    };
    const paths = MCP_CLIENT_GLOBAL_PATHS[c];
    return paths ? { ...base, scope: "global", paths } : { ...base, scope: "project" };
  });
}

/** Where to put a machine-scoped client's config, as printable lines. */
export function globalPathHint(block: McpConfigBlock & { scope: "global" }): string {
  return `${block.label} keeps every MCP server in one file, so merge this entry into it yourself:\n  ${block.paths.join("\n  ")}`;
}
