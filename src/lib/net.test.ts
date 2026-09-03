import { createServer, type Server } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { probeMcp, probeTcp } from "./net.js";

describe("probeTcp", () => {
  let server: Server;

  afterEach(() => {
    server?.close();
  });

  it("reports ok for an open port", async () => {
    const port = await new Promise<number>((resolve) => {
      server = createServer();
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });

    const result = await probeTcp("127.0.0.1", port, 2000);
    expect(result.ok).toBe(true);
    expect(result.ms).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it("reports not ok for a closed port", async () => {
    // Port 1 is privileged and never listening in the test sandbox.
    const result = await probeTcp("127.0.0.1", 1, 1500);
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe("string");
  });
});

describe("probeMcp", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats any HTTP response as reachable when no token is given", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401, json: () => Promise.resolve(null) });

    const result = await probeMcp("https://x.proxy.pgbeam.app/mcp", null);

    expect(result.reachable).toBe(true);
    expect(result.status).toBe(401);
    expect(result.tools).toBeUndefined();
    // No Authorization header when there is no token.
    const [, init] = mockFetch.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("returns the tool names when queried with a token", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          jsonrpc: "2.0",
          id: 1,
          result: { tools: [{ name: "query" }, { name: "list_tables" }] },
        }),
    });

    const result = await probeMcp("https://x.proxy.pgbeam.app/mcp", "pba_secret");

    expect(result.reachable).toBe(true);
    expect(result.tools).toEqual(["query", "list_tables"]);
    const [, init] = mockFetch.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer pba_secret");
  });

  it("reports reachable without tools when an authenticated call is rejected", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403, json: () => Promise.resolve(null) });

    const result = await probeMcp("https://x.proxy.pgbeam.app/mcp", "pba_secret");

    expect(result.reachable).toBe(true);
    expect(result.status).toBe(403);
    expect(result.tools).toBeUndefined();
  });

  it("reports unreachable on a network error", async () => {
    mockFetch.mockRejectedValue(new TypeError("fetch failed"));

    const result = await probeMcp("https://x.proxy.pgbeam.app/mcp", null);

    expect(result.reachable).toBe(false);
    expect(result.error).toContain("fetch failed");
  });
});
