import { describe, expect, it } from "vitest";
import {
  buildMcpConfigBlocks,
  claudeMcpAddCommand,
  globalPathHint,
  MCP_CLIENT_FILES,
  MCP_CLIENT_GLOBAL_PATHS,
  type McpClient,
  mcpClientConfig,
  mcpClients,
  parseMcpClient,
} from "./mcp-config.js";

const URL = "https://abc.proxy.pgbeam.app/mcp";
const TOKEN = "pba_a1b2c3d4e5f6g7h8";

describe("mcpClientConfig", () => {
  // `claude`, `cursor` and `vscode` mirror the dashboard `mcpClientConfig`
  // (frontend/apps/dashboard/lib/mcp-client-config.ts) exactly.
  const cases: { client: McpClient; expected: object; file: string }[] = [
    {
      client: "claude",
      file: ".mcp.json",
      expected: {
        mcpServers: { pgbeam: { url: URL, headers: { Authorization: `Bearer ${TOKEN}` } } },
      },
    },
    {
      client: "claude-desktop",
      file: "claude_desktop_config.json",
      expected: {
        mcpServers: {
          pgbeam: {
            command: "npx",
            args: [
              "-y",
              "mcp-remote",
              URL,
              "--header",
              // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder mcp-remote expands from env
              "Authorization:${PGBEAM_AUTH_HEADER}",
            ],
            env: { PGBEAM_AUTH_HEADER: `Bearer ${TOKEN}` },
          },
        },
      },
    },
    {
      client: "cursor",
      file: ".cursor/mcp.json",
      expected: {
        mcpServers: { pgbeam: { url: URL, headers: { Authorization: `Bearer ${TOKEN}` } } },
      },
    },
    {
      client: "vscode",
      file: ".vscode/mcp.json",
      expected: {
        servers: {
          pgbeam: { type: "http", url: URL, headers: { Authorization: `Bearer ${TOKEN}` } },
        },
      },
    },
    {
      client: "cline",
      file: "cline_mcp_settings.json",
      expected: {
        mcpServers: {
          pgbeam: {
            type: "streamableHttp",
            url: URL,
            headers: { Authorization: `Bearer ${TOKEN}` },
          },
        },
      },
    },
    {
      client: "windsurf",
      file: "mcp_config.json",
      expected: {
        mcpServers: { pgbeam: { serverUrl: URL, headers: { Authorization: `Bearer ${TOKEN}` } } },
      },
    },
  ];

  // Byte-for-byte expected output. Users paste these strings into an editor, and
  // catalog listings embed them, so a whitespace or key-order change is a
  // regression even when the parsed object is unchanged.
  const literals: Record<McpClient, string> = {
    claude: `{
  "mcpServers": {
    "pgbeam": {
      "url": "https://abc.proxy.pgbeam.app/mcp",
      "headers": {
        "Authorization": "Bearer pba_a1b2c3d4e5f6g7h8"
      }
    }
  }
}`,
    "claude-desktop": `{
  "mcpServers": {
    "pgbeam": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://abc.proxy.pgbeam.app/mcp",
        "--header",
        "Authorization:\${PGBEAM_AUTH_HEADER}"
      ],
      "env": {
        "PGBEAM_AUTH_HEADER": "Bearer pba_a1b2c3d4e5f6g7h8"
      }
    }
  }
}`,
    cursor: `{
  "mcpServers": {
    "pgbeam": {
      "url": "https://abc.proxy.pgbeam.app/mcp",
      "headers": {
        "Authorization": "Bearer pba_a1b2c3d4e5f6g7h8"
      }
    }
  }
}`,
    vscode: `{
  "servers": {
    "pgbeam": {
      "type": "http",
      "url": "https://abc.proxy.pgbeam.app/mcp",
      "headers": {
        "Authorization": "Bearer pba_a1b2c3d4e5f6g7h8"
      }
    }
  }
}`,
    cline: `{
  "mcpServers": {
    "pgbeam": {
      "type": "streamableHttp",
      "url": "https://abc.proxy.pgbeam.app/mcp",
      "headers": {
        "Authorization": "Bearer pba_a1b2c3d4e5f6g7h8"
      }
    }
  }
}`,
    windsurf: `{
  "mcpServers": {
    "pgbeam": {
      "serverUrl": "https://abc.proxy.pgbeam.app/mcp",
      "headers": {
        "Authorization": "Bearer pba_a1b2c3d4e5f6g7h8"
      }
    }
  }
}`,
  };

  it.each([...mcpClients])("emits the exact expected config text for %s", (client) => {
    expect(mcpClientConfig(client, URL, TOKEN)).toBe(literals[client]);
  });

  it("covers every supported client with a literal and a shape case", () => {
    expect(Object.keys(literals).sort()).toEqual([...mcpClients].sort());
    expect(cases.map((c) => c.client).sort()).toEqual([...mcpClients].sort());
  });

  it.each(cases)("produces the dashboard-matching shape for $client", ({ client, expected }) => {
    const config = mcpClientConfig(client, URL, TOKEN);
    expect(JSON.parse(config)).toEqual(expected);
  });

  it.each(cases)("is pretty-printed (2-space) JSON for $client", ({ client }) => {
    const config = mcpClientConfig(client, URL, TOKEN);
    expect(config).toContain("\n  ");
    // Round-trips to identical pretty output.
    expect(config).toBe(JSON.stringify(JSON.parse(config), null, 2));
  });

  it.each(cases)("maps $client to its conventional file path", ({ client, file }) => {
    expect(MCP_CLIENT_FILES[client]).toBe(file);
  });

  it("puts the token in a bearer credential, never inline in the URL", () => {
    for (const client of mcpClients) {
      const config = mcpClientConfig(client, URL, TOKEN);
      expect(config).toContain(`Bearer ${TOKEN}`);
      // The endpoint is always the bare URL: no token in a query string.
      expect(config).toContain(`"${URL}"`);
      expect(config).not.toContain(`${URL}?`);
    }
  });

  it("sets an Authorization header for every client that speaks HTTP directly", () => {
    for (const client of ["claude", "cursor", "vscode", "cline", "windsurf"] as const) {
      const parsed = JSON.parse(mcpClientConfig(client, URL, TOKEN));
      const server = client === "vscode" ? parsed.servers.pgbeam : parsed.mcpServers.pgbeam;
      expect(server.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(server.url ?? server.serverUrl).toBe(URL);
    }
  });

  it("requires an explicit transport type for Cline, which otherwise defaults to SSE", () => {
    const parsed = JSON.parse(mcpClientConfig("cline", URL, TOKEN));
    // "streamableHttp" is camelCase in Cline's schema. "streamable-http" or an
    // absent type silently falls back to SSE and 405s against our endpoint.
    expect(parsed.mcpServers.pgbeam.type).toBe("streamableHttp");
  });

  it("keys the Windsurf server off serverUrl, which is the only URL field it reads", () => {
    const parsed = JSON.parse(mcpClientConfig("windsurf", URL, TOKEN));
    expect(parsed.mcpServers.pgbeam.serverUrl).toBe(URL);
    expect(parsed.mcpServers.pgbeam).not.toHaveProperty("url");
    expect(parsed.mcpServers.pgbeam).not.toHaveProperty("type");
  });

  describe("claude-desktop", () => {
    const parsed: unknown = JSON.parse(mcpClientConfig("claude-desktop", URL, TOKEN));
    const server = (parsed as { mcpServers: { pgbeam: Record<string, unknown> } }).mcpServers
      .pgbeam;

    it("bridges the remote endpoint over mcp-remote, because the desktop config takes stdio only", () => {
      expect(server.command).toBe("npx");
      expect(server.args).toEqual([
        "-y",
        "mcp-remote",
        URL,
        "--header",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder mcp-remote expands from env
        "Authorization:${PGBEAM_AUTH_HEADER}",
      ]);
      // A direct remote entry would be silently dropped by Claude Desktop.
      expect(server).not.toHaveProperty("url");
      expect(server).not.toHaveProperty("type");
    });

    it("passes the bearer token through env, never as a spaced arg", () => {
      // Claude Desktop on Windows does not escape spaces in `args`, so the
      // header value must reach mcp-remote via the environment.
      expect(server.env).toEqual({ PGBEAM_AUTH_HEADER: `Bearer ${TOKEN}` });
      for (const arg of server.args as string[]) {
        expect(arg).not.toContain(TOKEN);
        expect(arg).not.toContain(" ");
      }
    });

    it("is machine-scoped, with per-OS paths for macOS and Windows", () => {
      expect(MCP_CLIENT_GLOBAL_PATHS["claude-desktop"]).toEqual([
        "macOS: ~/Library/Application Support/Claude/claude_desktop_config.json",
        "Windows: %APPDATA%\\Claude\\claude_desktop_config.json",
      ]);
    });

    it("leaves the project-scoped clients machine-unscoped", () => {
      for (const client of ["claude", "cursor", "vscode"] as const) {
        expect(MCP_CLIENT_GLOBAL_PATHS[client]).toBeUndefined();
      }
    });
  });

  it("gives every machine-scoped client a Windows path and a POSIX path", () => {
    for (const client of ["claude-desktop", "cline", "windsurf"] as const) {
      const paths = MCP_CLIENT_GLOBAL_PATHS[client];
      expect(paths).toBeDefined();
      expect(paths?.some((p) => p.startsWith("Windows: "))).toBe(true);
      expect(paths?.some((p) => p.startsWith("macOS"))).toBe(true);
    }
  });
});

describe("buildMcpConfigBlocks", () => {
  it("returns a single block for a specific client", () => {
    const blocks = buildMcpConfigBlocks(URL, TOKEN, "cursor");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      client: "cursor",
      file: ".cursor/mcp.json",
      label: "Cursor",
    });
    expect(JSON.parse(blocks[0].config)).toHaveProperty("mcpServers.pgbeam.url", URL);
  });

  it("returns one block per client when no client is given", () => {
    const blocks = buildMcpConfigBlocks(URL, TOKEN);
    expect(blocks.map((b) => b.client)).toEqual([
      "claude",
      "claude-desktop",
      "cursor",
      "vscode",
      "cline",
      "windsurf",
    ]);
    expect(blocks.map((b) => b.client)).toEqual([...mcpClients]);
  });

  it("marks the machine-wide clients global and the rest project-scoped", () => {
    const scopes = Object.fromEntries(
      buildMcpConfigBlocks(URL, TOKEN).map((b) => [b.client, b.scope]),
    );
    expect(scopes).toEqual({
      claude: "project",
      "claude-desktop": "global",
      cursor: "project",
      vscode: "project",
      cline: "global",
      windsurf: "global",
    });
  });

  it("carries the per-OS paths on the global block only", () => {
    const [block] = buildMcpConfigBlocks(URL, TOKEN, "claude-desktop");
    expect(block.scope).toBe("global");
    if (block.scope !== "global") throw new Error("expected a global block");
    expect(block.paths).toHaveLength(2);
    expect(globalPathHint(block)).toContain("Library/Application Support/Claude");
    expect(globalPathHint(block)).toContain("%APPDATA%\\Claude");

    const [cursor] = buildMcpConfigBlocks(URL, TOKEN, "cursor");
    expect(cursor).not.toHaveProperty("paths");
  });
});

describe("parseMcpClient", () => {
  it.each([...mcpClients])("accepts %s", (client) => {
    expect(parseMcpClient(client)).toBe(client);
  });

  it("rejects an unknown client", () => {
    expect(() => parseMcpClient("zed")).toThrowError(/Invalid client/);
  });
});

describe("claudeMcpAddCommand", () => {
  it("emits a transport-http add command with a bearer header", () => {
    const cmd = claudeMcpAddCommand(URL, TOKEN);
    expect(cmd).toContain("claude mcp add --transport http pgbeam");
    expect(cmd).toContain(URL);
    expect(cmd).toContain(`Authorization: Bearer ${TOKEN}`);
  });
});
