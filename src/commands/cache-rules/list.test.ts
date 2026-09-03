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
  outputTable: vi.fn(),
}));

vi.mock("consola", () => ({
  consola: { info: vi.fn(), log: vi.fn() },
}));

import { requireProject, resolveContext } from "../../lib/client.js";
import { output } from "../../lib/output.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mockListCacheRules = vi.fn();

function setupContext(projectId = "proj-1") {
  vi.mocked(resolveContext).mockReturnValue({
    client: {
      projects: { listCacheRules: mockListCacheRules },
    },
    orgId: "org-1",
    projectId,
  } as never);
  vi.mocked(requireProject).mockReturnValue(projectId);
}

async function runHandler(args: Record<string, unknown>) {
  const mod = await import("./list.js");
  const command = mod.default;
  await command.run?.({ args: { json: false, "no-color": false, debug: false, ...args } } as never);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
});

describe("cache-rules list", () => {
  it("calls listCacheRules with correct path and query params", async () => {
    setupContext();
    mockListCacheRules.mockResolvedValue({ entries: [], next_page_token: null });

    await runHandler({ "database-id": "db-1" });

    expect(mockListCacheRules).toHaveBeenCalledWith({
      pathParams: { project_id: "proj-1", database_id: "db-1" },
      queryParams: {
        page_size: undefined,
        page_token: undefined,
      },
    });
  });

  it("passes page-size and page-token as query params", async () => {
    setupContext();
    mockListCacheRules.mockResolvedValue({ entries: [], next_page_token: null });

    await runHandler({ "database-id": "db-1", "page-size": "50", "page-token": "tok-abc" });

    expect(mockListCacheRules).toHaveBeenCalledWith({
      pathParams: { project_id: "proj-1", database_id: "db-1" },
      queryParams: {
        page_size: 50,
        page_token: "tok-abc",
      },
    });
  });

  it("invokes output with the result", async () => {
    setupContext();
    const result = {
      entries: [
        {
          query_hash: "abc",
          normalized_sql: "SELECT * FROM users WHERE id = $1",
          query_type: "SELECT",
          cache_enabled: true,
          call_count: 1000,
          avg_latency_ms: 2.5,
          recommendation: "cache",
        },
      ],
      next_page_token: null,
    };
    mockListCacheRules.mockResolvedValue(result);

    await runHandler({ "database-id": "db-1" });

    expect(output).toHaveBeenCalledWith(result, false, expect.any(Function));
  });

  it("invokes output with json=true when --json is set", async () => {
    setupContext();
    const result = { entries: [], next_page_token: null };
    mockListCacheRules.mockResolvedValue(result);

    await runHandler({ "database-id": "db-1", json: true });

    expect(output).toHaveBeenCalledWith(result, true, expect.any(Function));
  });

  it("table callback shows empty message when no entries", async () => {
    setupContext();
    mockListCacheRules.mockResolvedValue({ entries: [], next_page_token: null });
    await runHandler({ "database-id": "db-1" });

    const { consola } = await import("consola");
    const tableFn = vi.mocked(output).mock.calls[0][2] as () => void;
    tableFn();
    expect(consola.info).toHaveBeenCalledWith("No cache rules found.");
  });

  it("table callback formats entries with outputTable", async () => {
    setupContext();
    const result = {
      entries: [
        {
          query_hash: "abc",
          normalized_sql: "SELECT * FROM users WHERE id = $1",
          query_type: "SELECT",
          cache_enabled: true,
          call_count: 1000,
          avg_latency_ms: 2.5,
          recommendation: "cache",
        },
      ],
      next_page_token: null,
    };
    mockListCacheRules.mockResolvedValue(result);
    await runHandler({ "database-id": "db-1" });

    const { outputTable } = await import("../../lib/output.js");
    const tableFn = vi.mocked(output).mock.calls[0][2] as () => void;
    tableFn();
    expect(outputTable).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ hash: "abc", cached: "yes" })]),
      expect.any(Array),
    );
  });

  it("table callback shows next page token when present", async () => {
    setupContext();
    const result = {
      entries: [
        {
          query_hash: "abc",
          normalized_sql: "SELECT 1",
          query_type: "SELECT",
          cache_enabled: true,
          call_count: 100,
          avg_latency_ms: 1.0,
          recommendation: "cache",
        },
      ],
      next_page_token: "tok-next-123",
    };
    mockListCacheRules.mockResolvedValue(result);
    await runHandler({ "database-id": "db-1" });

    const { consola } = await import("consola");
    const tableFn = vi.mocked(output).mock.calls[0][2] as () => void;
    tableFn();
    expect(consola.log).toHaveBeenCalledWith(expect.stringContaining("tok-next-123"));
  });
});
