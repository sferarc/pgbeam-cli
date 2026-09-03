import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("citty", () => ({
  defineCommand: (config: Record<string, unknown>) => config,
}));

vi.mock("../lib/flags.js", () => ({
  globalArgs: {},
}));

const mockStartMcpServer = vi.fn();

vi.mock("../mcp/server.js", () => ({
  startMcpServer: mockStartMcpServer,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function runHandler(args: Record<string, unknown> = {}) {
  const mod = await import("./mcp.js");
  const command = mod.default;
  await command.run?.({ args: { json: false, "no-color": false, debug: false, ...args } } as never);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
});

describe("mcp", () => {
  it("calls startMcpServer with the provided args", async () => {
    mockStartMcpServer.mockResolvedValue(undefined);

    const args = { json: false, "no-color": false, debug: false, token: "tok-123" };
    await runHandler(args);

    expect(mockStartMcpServer).toHaveBeenCalledWith(args);
  });

  it("propagates errors from startMcpServer", async () => {
    mockStartMcpServer.mockRejectedValue(new Error("MCP server failed"));

    await expect(runHandler()).rejects.toThrow("MCP server failed");
  });
});
