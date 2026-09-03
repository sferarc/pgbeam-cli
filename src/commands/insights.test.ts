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

vi.mock("../lib/client.js", () => ({
  resolveContext: vi.fn(),
  requireProject: vi.fn(),
}));

vi.mock("../lib/errors.js", () => ({
  runCommand: vi.fn(async (fn: () => Promise<void>) => fn()),
}));

vi.mock("../lib/output.js", () => ({
  output: vi.fn(),
  outputTable: vi.fn(),
}));

vi.mock("consola", () => ({
  consola: { info: vi.fn(), log: vi.fn() },
}));

import { consola } from "consola";
import { requireProject, resolveContext } from "../lib/client.js";
import { output, outputTable } from "../lib/output.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mockGetProjectInsights = vi.fn();

function setupContext(projectId = "proj-1") {
  vi.mocked(resolveContext).mockReturnValue({
    client: {
      analytics: { getProjectInsights: mockGetProjectInsights },
    },
    orgId: "org-1",
    projectId,
  } as never);
  vi.mocked(requireProject).mockReturnValue(projectId);
}

async function runHandler(args: Record<string, unknown> = {}) {
  const mod = await import("./insights.js");
  const command = mod.default;
  await command.run?.({
    args: { json: false, "no-color": false, debug: false, range: "24h", ...args },
  } as never);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
});

describe("insights", () => {
  it("calls getProjectInsights with default range", async () => {
    setupContext();
    mockGetProjectInsights.mockResolvedValue({
      cache: { hit_rate: 0.8 },
      latency: { avg_ms: 1.5, p99_ms: 5.0 },
      queries: [],
    });

    await runHandler();

    expect(mockGetProjectInsights).toHaveBeenCalledWith({
      pathParams: { project_id: "proj-1" },
      queryParams: { range: "24h" },
    });
  });

  it("passes custom range", async () => {
    setupContext();
    mockGetProjectInsights.mockResolvedValue({
      cache: { hit_rate: 0.5 },
      latency: { avg_ms: 2.0, p99_ms: 10.0 },
      queries: [],
    });

    await runHandler({ range: "7d" });

    expect(mockGetProjectInsights).toHaveBeenCalledWith({
      pathParams: { project_id: "proj-1" },
      queryParams: { range: "7d" },
    });
  });

  it("throws for invalid range", async () => {
    setupContext();

    await expect(runHandler({ range: "invalid" })).rejects.toThrow("Invalid range");
  });

  it("invokes output with the result", async () => {
    setupContext();
    const result = {
      cache: { hit_rate: 0.9 },
      latency: { avg_ms: 0.5, p99_ms: 2.0 },
      queries: [
        {
          query_pattern: "SELECT * FROM users",
          total_count: 1000,
          avg_latency_ms: 0.3,
          total_cache_hits: 900,
        },
      ],
    };
    mockGetProjectInsights.mockResolvedValue(result);

    await runHandler();

    expect(output).toHaveBeenCalledWith(result, false, expect.any(Function));
  });

  it("passes json=true to output when --json is set", async () => {
    setupContext();
    mockGetProjectInsights.mockResolvedValue({
      cache: { hit_rate: 0 },
      latency: { avg_ms: 0, p99_ms: 0 },
      queries: [],
    });

    await runHandler({ json: true });

    expect(output).toHaveBeenCalledWith(expect.anything(), true, expect.any(Function));
  });

  it("accepts 1h range", async () => {
    setupContext();
    mockGetProjectInsights.mockResolvedValue({
      cache: { hit_rate: 0.5 },
      latency: { avg_ms: 1.0, p99_ms: 3.0 },
      queries: [],
    });

    await runHandler({ range: "1h" });

    expect(mockGetProjectInsights).toHaveBeenCalledWith({
      pathParams: { project_id: "proj-1" },
      queryParams: { range: "1h" },
    });
  });

  it("accepts 6h range", async () => {
    setupContext();
    mockGetProjectInsights.mockResolvedValue({
      cache: { hit_rate: 0.5 },
      latency: { avg_ms: 1.0, p99_ms: 3.0 },
      queries: [],
    });

    await runHandler({ range: "6h" });

    expect(mockGetProjectInsights).toHaveBeenCalledWith({
      pathParams: { project_id: "proj-1" },
      queryParams: { range: "6h" },
    });
  });

  it("resolves context and requires project", async () => {
    setupContext("proj-custom");
    mockGetProjectInsights.mockResolvedValue({
      cache: { hit_rate: 0 },
      latency: { avg_ms: 0, p99_ms: 0 },
      queries: [],
    });

    await runHandler();

    expect(resolveContext).toHaveBeenCalled();
    expect(requireProject).toHaveBeenCalled();
  });

  it("table output function logs cache hit rate percentage", async () => {
    setupContext();
    mockGetProjectInsights.mockResolvedValue({
      cache: { hit_rate: 0.85 },
      latency: { avg_ms: 1.2, p99_ms: 4.0 },
      queries: [],
    });

    await runHandler();

    // Get the table rendering function (3rd arg to output)
    const tableFn = vi.mocked(output).mock.calls[0][2] as () => void;
    tableFn();

    expect(consola.log).toHaveBeenCalledWith(expect.stringContaining("85.0%"));
  });

  it("table output shows query table when queries exist", async () => {
    setupContext();
    mockGetProjectInsights.mockResolvedValue({
      cache: { hit_rate: 0.9 },
      latency: { avg_ms: 0.5, p99_ms: 2.0 },
      queries: [
        {
          query_pattern: "SELECT * FROM users WHERE id = $1",
          total_count: 5000,
          avg_latency_ms: 0.8,
          total_cache_hits: 4500,
        },
      ],
    });

    await runHandler();

    const tableFn = vi.mocked(output).mock.calls[0][2] as () => void;
    tableFn();

    expect(outputTable).toHaveBeenCalled();
    expect(consola.log).toHaveBeenCalledWith("Top queries:\n");
  });

  it("table output shows info message when no queries", async () => {
    setupContext();
    mockGetProjectInsights.mockResolvedValue({
      cache: { hit_rate: 0 },
      latency: { avg_ms: 0, p99_ms: 0 },
      queries: [],
    });

    await runHandler();

    const tableFn = vi.mocked(output).mock.calls[0][2] as () => void;
    tableFn();

    expect(consola.info).toHaveBeenCalledWith("No query insights available for this range.");
  });

  it("table output truncates long query patterns to 60 chars", async () => {
    setupContext();
    const longQuery =
      "SELECT a, b, c, d, e, f, g, h FROM very_long_table_name WHERE some_column = $1 AND another = $2";
    mockGetProjectInsights.mockResolvedValue({
      cache: { hit_rate: 0.5 },
      latency: { avg_ms: 1.0, p99_ms: 3.0 },
      queries: [
        {
          query_pattern: longQuery,
          total_count: 100,
          avg_latency_ms: 1.0,
          total_cache_hits: 50,
        },
      ],
    });

    await runHandler();

    const tableFn = vi.mocked(output).mock.calls[0][2] as () => void;
    tableFn();

    const tableData = vi.mocked(outputTable).mock.calls[0][0] as Array<{ pattern: string }>;
    expect(tableData[0].pattern.length).toBeLessThanOrEqual(60);
  });

  it("displays avg latency and p99 latency in table output", async () => {
    setupContext();
    mockGetProjectInsights.mockResolvedValue({
      cache: { hit_rate: 0.75 },
      latency: { avg_ms: 2.345, p99_ms: 12.678 },
      queries: [],
    });

    await runHandler();

    const tableFn = vi.mocked(output).mock.calls[0][2] as () => void;
    tableFn();

    expect(consola.log).toHaveBeenCalledWith(expect.stringContaining("2.3"));
    expect(consola.log).toHaveBeenCalledWith(expect.stringContaining("12.7"));
  });
});

describe("insights command metadata", () => {
  it("has correct meta name and description", async () => {
    const mod = await import("./insights.js");
    const command = mod.default;
    expect((command.meta as { name: string }).name).toBe("insights");
    expect((command.meta as { description: string }).description).toBe(
      "Show project query insights",
    );
  });

  it("defines range argument with default 24h", async () => {
    const mod = await import("./insights.js");
    const command = mod.default;
    const args = command.args as unknown as Record<string, { type: string; default?: string }>;
    expect(args.range).toBeDefined();
    expect(args.range.type).toBe("string");
    expect(args.range.default).toBe("24h");
  });
});
