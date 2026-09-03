import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("consola", () => ({
  consola: {
    success: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    box: vi.fn(),
  },
}));

vi.mock("../../lib/errors.js", () => ({
  runCommand: vi.fn(async (fn: () => Promise<void>) => fn()),
}));

import { readFile, writeFile } from "node:fs/promises";
import { consola } from "consola";
import mcpConfigCommand from "./mcp-config.js";

const run = mcpConfigCommand.run;
if (!run) throw new Error("command.run is not defined");

const URL = "https://abc.proxy.pgbeam.app/mcp";
const TOKEN = "pba_xxx";

const baseArgs = {
  url: undefined,
  "mcp-token": undefined,
  "from-json": false,
  "from-file": undefined,
  client: "claude",
  write: false,
  json: false,
  "no-color": false,
  debug: false,
} as const;

describe("agents mcp-config", () => {
  let stdout: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  it("emits Claude config as JSON from --url/--mcp-token", async () => {
    await run({
      args: { ...baseArgs, url: URL, "mcp-token": TOKEN, json: true },
    } as never);

    const written = stdout.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    const parsed = JSON.parse(written);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ client: "claude", file: ".mcp.json" });
    expect(JSON.parse(parsed[0].config)).toHaveProperty("mcpServers.pgbeam.url", URL);
  });

  it("emits all clients with --client all", async () => {
    await run({
      args: { ...baseArgs, url: URL, "mcp-token": TOKEN, client: "all", json: true },
    } as never);

    const written = stdout.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    const parsed = JSON.parse(written);
    expect(parsed.map((b: { client: string }) => b.client)).toEqual([
      "claude",
      "claude-desktop",
      "cursor",
      "vscode",
      "cline",
      "windsurf",
    ]);
  });

  it("emits the mcp-remote bridge for --client claude-desktop", async () => {
    await run({
      args: { ...baseArgs, url: URL, "mcp-token": TOKEN, client: "claude-desktop", json: true },
    } as never);

    const written = stdout.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    const parsed = JSON.parse(written);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      client: "claude-desktop",
      file: "claude_desktop_config.json",
    });
    expect(JSON.parse(parsed[0].config)).toHaveProperty("mcpServers.pgbeam.command", "npx");
  });

  it.each([
    { client: "cline", file: "cline_mcp_settings.json", key: "mcpServers.pgbeam.type" },
    { client: "windsurf", file: "mcp_config.json", key: "mcpServers.pgbeam.serverUrl" },
  ])("emits $client config to $file", async ({ client, file, key }) => {
    await run({
      args: { ...baseArgs, url: URL, "mcp-token": TOKEN, client, json: true },
    } as never);

    const written = stdout.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    const parsed = JSON.parse(written);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ client, file });
    expect(JSON.parse(parsed[0].config)).toHaveProperty(key);
  });

  it("writes config to the client's file path with --write", async () => {
    await run({
      args: { ...baseArgs, url: URL, "mcp-token": TOKEN, client: "cursor", write: true },
    } as never);

    expect(writeFile).toHaveBeenCalledWith(
      ".cursor/mcp.json",
      expect.stringContaining('"mcpServers"'),
      "utf8",
    );
    expect(consola.success).toHaveBeenCalledWith("Wrote Cursor config to .cursor/mcp.json");
  });

  it("never overwrites the machine-wide Claude Desktop config with --write", async () => {
    await run({
      args: { ...baseArgs, url: URL, "mcp-token": TOKEN, client: "claude-desktop", write: true },
    } as never);

    expect(writeFile).not.toHaveBeenCalled();
    expect(consola.warn).toHaveBeenCalledWith(
      expect.stringContaining("Library/Application Support/Claude/claude_desktop_config.json"),
    );
  });

  it("still writes the project-scoped clients when --client all --write", async () => {
    await run({
      args: { ...baseArgs, url: URL, "mcp-token": TOKEN, client: "all", write: true },
    } as never);

    const targets = vi.mocked(writeFile).mock.calls.map((c) => c[0]);
    expect(targets).toEqual([".mcp.json", ".cursor/mcp.json", ".vscode/mcp.json"]);
    // Claude Desktop, Cline and Windsurf each warn instead of clobbering.
    expect(consola.warn).toHaveBeenCalledTimes(3);
  });

  it("reads secrets from a JSON file via --from-file", async () => {
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ mcp_url: URL, mcp_token: TOKEN }) as never,
    );

    await run({
      args: { ...baseArgs, "from-file": "secrets.json", json: true },
    } as never);

    expect(readFile).toHaveBeenCalledWith("secrets.json", "utf8");
    const written = stdout.mock.calls.map((c: unknown[]) => String(c[0])).join("");
    expect(JSON.parse(written)[0].config).toContain(TOKEN);
  });

  it("throws when a --from-file blob lacks mcp_url/mcp_token", async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ foo: "bar" }) as never);

    await expect(
      run({ args: { ...baseArgs, "from-file": "secrets.json", json: true } } as never),
    ).rejects.toThrowError(/mcp_url/);
  });

  it("throws when neither --url nor --from-json/--from-file is provided", async () => {
    await expect(run({ args: { ...baseArgs, json: true } } as never)).rejects.toThrowError(
      /--url plus --mcp-token, or .*--from-json.*--from-file/,
    );
  });

  it("throws the same guidance when --url is given without --mcp-token", async () => {
    await expect(
      run({ args: { ...baseArgs, url: "https://x.proxy.pgbeam.app/mcp", json: true } } as never),
    ).rejects.toThrowError(/--url plus --mcp-token/);
  });
});
