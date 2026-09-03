import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("citty", () => ({
  defineCommand: (config: Record<string, unknown>) => config,
}));

vi.mock("../../lib/flags.js", () => ({
  globalArgs: {},
}));

vi.mock("../../lib/client.js", () => ({
  resolveContext: vi.fn(),
  requireProject: vi.fn(),
}));

vi.mock("../../lib/errors.js", () => ({
  runCommand: vi.fn(async (fn: () => Promise<void>) => fn()),
}));

vi.mock("../../lib/output.js", () => ({
  output: vi.fn(),
}));

vi.mock("consola", () => ({
  consola: { success: vi.fn(), log: vi.fn(), error: vi.fn() },
}));

import { requireProject, resolveContext } from "../../lib/client.js";
import { output } from "../../lib/output.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mockUpdateCacheRule = vi.fn();

function setupContext(projectId = "proj-1") {
  vi.mocked(resolveContext).mockReturnValue({
    client: {
      projects: { updateCacheRule: mockUpdateCacheRule },
    },
    orgId: "org-1",
    projectId,
  } as never);
  vi.mocked(requireProject).mockReturnValue(projectId);
}

async function runHandler(args: Record<string, unknown>) {
  const mod = await import("./set.js");
  const command = mod.default;
  await command.run?.({ args: { json: false, "no-color": false, debug: false, ...args } } as never);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
});

describe("cache-rules set", () => {
  it("calls updateCacheRule with correct params when enabled=true", async () => {
    setupContext();
    mockUpdateCacheRule.mockResolvedValue({
      entry: { cache_enabled: true, cache_ttl_seconds: 60, cache_swr_seconds: 10 },
    });

    await runHandler({
      "database-id": "db-1",
      "query-hash": "abc123",
      enabled: "true",
      ttl: "60",
      swr: "10",
    });

    expect(mockUpdateCacheRule).toHaveBeenCalledWith({
      pathParams: {
        project_id: "proj-1",
        database_id: "db-1",
        query_hash: "abc123",
      },
      body: {
        cache_enabled: true,
        cache_ttl_seconds: 60,
        cache_swr_seconds: 10,
      },
    });
    expect(output).toHaveBeenCalled();
  });

  it("calls updateCacheRule with enabled=false and null ttl/swr when omitted", async () => {
    setupContext();
    mockUpdateCacheRule.mockResolvedValue({
      entry: { cache_enabled: false, cache_ttl_seconds: null, cache_swr_seconds: null },
    });

    await runHandler({
      "database-id": "db-1",
      "query-hash": "abc123",
      enabled: "false",
    });

    expect(mockUpdateCacheRule).toHaveBeenCalledWith({
      pathParams: {
        project_id: "proj-1",
        database_id: "db-1",
        query_hash: "abc123",
      },
      body: {
        cache_enabled: false,
        cache_ttl_seconds: null,
        cache_swr_seconds: null,
      },
    });
  });

  it("throws when --enabled is not true or false", async () => {
    setupContext();

    await expect(
      runHandler({
        "database-id": "db-1",
        "query-hash": "abc123",
        enabled: "maybe",
      }),
    ).rejects.toThrow('--enabled must be "true" or "false".');
  });

  it("throws when --ttl is not a number", async () => {
    setupContext();

    await expect(
      runHandler({
        "database-id": "db-1",
        "query-hash": "abc123",
        enabled: "true",
        ttl: "abc",
      }),
    ).rejects.toThrow("--ttl must be a number.");
  });

  it("throws when --swr is not a number", async () => {
    setupContext();

    await expect(
      runHandler({
        "database-id": "db-1",
        "query-hash": "abc123",
        enabled: "true",
        swr: "xyz",
      }),
    ).rejects.toThrow("--swr must be a number.");
  });

  it("invokes output with the API result", async () => {
    setupContext();
    const result = {
      entry: { cache_enabled: true, cache_ttl_seconds: 30, cache_swr_seconds: 5 },
    };
    mockUpdateCacheRule.mockResolvedValue(result);

    await runHandler({
      "database-id": "db-1",
      "query-hash": "abc123",
      enabled: "true",
    });

    expect(output).toHaveBeenCalledWith(result, false, expect.any(Function));
  });

  it("table callback logs cache rule details", async () => {
    setupContext();
    const result = {
      entry: { cache_enabled: true, cache_ttl_seconds: 30, cache_swr_seconds: 5 },
    };
    mockUpdateCacheRule.mockResolvedValue(result);
    await runHandler({
      "database-id": "db-1",
      "query-hash": "abc123",
      enabled: "true",
    });

    const { consola } = await import("consola");
    const tableFn = vi.mocked(output).mock.calls[0][2] as () => void;
    tableFn();
    expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("abc123"));
    expect(consola.log).toHaveBeenCalledWith(expect.stringContaining("yes"));
  });

  it("table callback shows default for null ttl/swr", async () => {
    setupContext();
    const result = {
      entry: { cache_enabled: false, cache_ttl_seconds: null, cache_swr_seconds: null },
    };
    mockUpdateCacheRule.mockResolvedValue(result);
    await runHandler({
      "database-id": "db-1",
      "query-hash": "def456",
      enabled: "false",
    });

    const { consola } = await import("consola");
    const tableFn = vi.mocked(output).mock.calls[0][2] as () => void;
    tableFn();
    expect(consola.log).toHaveBeenCalledWith(expect.stringContaining("no"));
    expect(consola.log).toHaveBeenCalledWith(expect.stringContaining("default"));
  });
});
