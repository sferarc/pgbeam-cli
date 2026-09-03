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
const mockGetProjectMetrics = vi.fn();

function setupContext(projectId = "proj-1") {
  vi.mocked(resolveContext).mockReturnValue({
    client: {
      projects: { getProjectMetrics: mockGetProjectMetrics },
    },
    orgId: "org-1",
    projectId,
  } as never);
  vi.mocked(requireProject).mockReturnValue(projectId);
}

async function runHandler(args: Record<string, unknown> = {}) {
  const mod = await import("./metrics.js");
  const command = mod.default;
  await command.run?.({
    args: { json: false, "no-color": false, debug: false, limit: "10", ...args },
  } as never);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
});

describe("metrics", () => {
  it("calls getProjectMetrics with correct params", async () => {
    setupContext();
    mockGetProjectMetrics.mockResolvedValue({ snapshots: [] });

    await runHandler();

    expect(mockGetProjectMetrics).toHaveBeenCalledWith({
      pathParams: { project_id: "proj-1" },
      queryParams: { limit: 10, region: undefined },
    });
  });

  it("passes region filter when provided", async () => {
    setupContext();
    mockGetProjectMetrics.mockResolvedValue({ snapshots: [] });

    await runHandler({ region: "us-east-1" });

    expect(mockGetProjectMetrics).toHaveBeenCalledWith({
      pathParams: { project_id: "proj-1" },
      queryParams: { limit: 10, region: "us-east-1" },
    });
  });

  it("passes custom limit", async () => {
    setupContext();
    mockGetProjectMetrics.mockResolvedValue({ snapshots: [] });

    await runHandler({ limit: "25" });

    expect(mockGetProjectMetrics).toHaveBeenCalledWith({
      pathParams: { project_id: "proj-1" },
      queryParams: { limit: 25, region: undefined },
    });
  });

  it("invokes output with the result", async () => {
    setupContext();
    const result = {
      snapshots: [
        {
          region: "us-east-1",
          queries_total: 5000,
          cache_hits: 3000,
          active_connections: 15,
          avg_latency_ms: 1.2,
          p99_latency_ms: 4.5,
        },
      ],
    };
    mockGetProjectMetrics.mockResolvedValue(result);

    await runHandler();

    expect(output).toHaveBeenCalledWith(result, false, expect.any(Function));
  });

  it("passes json=true to output when --json is set", async () => {
    setupContext();
    mockGetProjectMetrics.mockResolvedValue({ snapshots: [] });

    await runHandler({ json: true });

    expect(output).toHaveBeenCalledWith(expect.anything(), true, expect.any(Function));
  });

  it("resolves context and requires project", async () => {
    setupContext("proj-custom");
    mockGetProjectMetrics.mockResolvedValue({ snapshots: [] });

    await runHandler();

    expect(resolveContext).toHaveBeenCalled();
    expect(requireProject).toHaveBeenCalled();
  });

  it("uses different project IDs", async () => {
    setupContext("proj-abc");
    mockGetProjectMetrics.mockResolvedValue({ snapshots: [] });

    await runHandler();

    expect(mockGetProjectMetrics).toHaveBeenCalledWith({
      pathParams: { project_id: "proj-abc" },
      queryParams: { limit: 10, region: undefined },
    });
  });

  it("table output shows info when no snapshots", async () => {
    setupContext();
    mockGetProjectMetrics.mockResolvedValue({ snapshots: [] });

    await runHandler();

    const tableFn = vi.mocked(output).mock.calls[0][2] as () => void;
    tableFn();

    expect(consola.info).toHaveBeenCalledWith("No metrics available.");
  });

  it("table output renders snapshot table when data exists", async () => {
    setupContext();
    const result = {
      snapshots: [
        {
          region: "us-east-1",
          queries_total: 5000,
          cache_hits: 3000,
          active_connections: 15,
          avg_latency_ms: 1.2,
          p99_latency_ms: 4.5,
        },
      ],
    };
    mockGetProjectMetrics.mockResolvedValue(result);

    await runHandler();

    const tableFn = vi.mocked(output).mock.calls[0][2] as () => void;
    tableFn();

    expect(outputTable).toHaveBeenCalled();
    const tableData = vi.mocked(outputTable).mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(tableData).toHaveLength(1);
    expect(tableData[0].region).toBe("us-east-1");
  });

  it("table output formats queries and cache_hits with locale string", async () => {
    setupContext();
    const result = {
      snapshots: [
        {
          region: "eu-west-1",
          queries_total: 1234567,
          cache_hits: 987654,
          active_connections: 42,
          avg_latency_ms: 3.456,
          p99_latency_ms: 15.789,
        },
      ],
    };
    mockGetProjectMetrics.mockResolvedValue(result);

    await runHandler();

    const tableFn = vi.mocked(output).mock.calls[0][2] as () => void;
    tableFn();

    const tableData = vi.mocked(outputTable).mock.calls[0][0] as Array<Record<string, unknown>>;
    // toLocaleString formats numbers with commas
    expect(tableData[0].queries).toBe((1234567).toLocaleString());
    expect(tableData[0].cache_hits).toBe((987654).toLocaleString());
  });

  it("table output formats latency with 1 decimal place", async () => {
    setupContext();
    const result = {
      snapshots: [
        {
          region: "us-east-1",
          queries_total: 100,
          cache_hits: 50,
          active_connections: 5,
          avg_latency_ms: 2.345,
          p99_latency_ms: 10.678,
        },
      ],
    };
    mockGetProjectMetrics.mockResolvedValue(result);

    await runHandler();

    const tableFn = vi.mocked(output).mock.calls[0][2] as () => void;
    tableFn();

    const tableData = vi.mocked(outputTable).mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(tableData[0].avg_ms).toBe("2.3");
    expect(tableData[0].p99_ms).toBe("10.7");
  });

  it("table output includes correct column definitions", async () => {
    setupContext();
    const result = {
      snapshots: [
        {
          region: "us-east-1",
          queries_total: 100,
          cache_hits: 50,
          active_connections: 5,
          avg_latency_ms: 1.0,
          p99_latency_ms: 3.0,
        },
      ],
    };
    mockGetProjectMetrics.mockResolvedValue(result);

    await runHandler();

    const tableFn = vi.mocked(output).mock.calls[0][2] as () => void;
    tableFn();

    const columns = vi.mocked(outputTable).mock.calls[0][1] as Array<{
      key: string;
      label: string;
    }>;
    const labels = columns.map((c) => c.label);
    expect(labels).toContain("Region");
    expect(labels).toContain("Queries");
    expect(labels).toContain("Cache Hits");
    expect(labels).toContain("Connections");
    expect(labels).toContain("Avg (ms)");
    expect(labels).toContain("P99 (ms)");
  });

  it("handles multiple snapshots", async () => {
    setupContext();
    const result = {
      snapshots: [
        {
          region: "us-east-1",
          queries_total: 5000,
          cache_hits: 3000,
          active_connections: 15,
          avg_latency_ms: 1.2,
          p99_latency_ms: 4.5,
        },
        {
          region: "eu-west-1",
          queries_total: 2000,
          cache_hits: 1500,
          active_connections: 8,
          avg_latency_ms: 2.1,
          p99_latency_ms: 6.3,
        },
      ],
    };
    mockGetProjectMetrics.mockResolvedValue(result);

    await runHandler();

    const tableFn = vi.mocked(output).mock.calls[0][2] as () => void;
    tableFn();

    const tableData = vi.mocked(outputTable).mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(tableData).toHaveLength(2);
  });
});

describe("metrics command metadata", () => {
  it("has correct meta name and description", async () => {
    const mod = await import("./metrics.js");
    const command = mod.default;
    expect((command.meta as { name: string }).name).toBe("metrics");
    expect((command.meta as { description: string }).description).toBe("Show project metrics");
  });

  it("defines limit argument with default 10", async () => {
    const mod = await import("./metrics.js");
    const command = mod.default;
    const args = command.args as unknown as Record<string, { type: string; default?: string }>;
    expect(args.limit).toBeDefined();
    expect(args.limit.type).toBe("string");
    expect(args.limit.default).toBe("10");
  });

  it("defines optional region argument", async () => {
    const mod = await import("./metrics.js");
    const command = mod.default;
    const args = command.args as unknown as Record<string, { type: string; description: string }>;
    expect(args.region).toBeDefined();
    expect(args.region.type).toBe("string");
  });
});
