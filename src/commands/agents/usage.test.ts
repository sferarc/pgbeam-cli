import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("consola", () => ({
  consola: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    log: vi.fn(),
  },
}));

vi.mock("../../lib/client.js", () => ({
  resolveContext: vi.fn(),
  requireProject: vi.fn(),
}));

vi.mock("../../lib/errors.js", () => ({
  runCommand: vi.fn(async (fn) => fn()),
}));

import { consola } from "consola";
import { requireProject, resolveContext } from "../../lib/client.js";
import usageCommand from "./usage.js";

const run = usageCommand.run;
if (!run) throw new Error("command.run is not defined");

const mockGetAgentUsageBreakdown = vi.fn();
const baseArgs = { json: false, "no-color": false, debug: false };

function line(overrides: Record<string, unknown> = {}) {
  return {
    credential_id: null,
    entries: 0,
    allowed: 0,
    blocked: 0,
    masked: 0,
    truncated: 0,
    rows_returned: 0,
    bytes_out: 0,
    cache_hit: 0,
    cache_stale: 0,
    cache_miss: 0,
    cache_bypass: 0,
    cache_none: 0,
    latency_measured: 0,
    latency_unmeasured: 0,
    latency_ms_total: 0,
    latency_p50_ms: 0,
    latency_p95_ms: 0,
    latency_p99_ms: 0,
    ...overrides,
  };
}

const REPORT = {
  project_id: "prj_1",
  requested_start: "2026-08-03T00:00:00Z",
  requested_end: "2026-09-02T00:00:00Z",
  window_start: "2026-09-01T00:00:00Z",
  window_end: "2026-09-02T00:00:00Z",
  complete: true,
  agents: [
    line({
      credential_id: "agt_one",
      entries: 10,
      allowed: 8,
      blocked: 2,
      rows_returned: 400,
      bytes_out: 4096,
      latency_measured: 8,
      latency_p50_ms: 12.5,
      latency_p99_ms: 40.25,
    }),
  ],
  unattributed: line({ entries: 3, blocked: 3 }),
  totals: line({ entries: 13, allowed: 8, blocked: 5, rows_returned: 400, bytes_out: 4096 }),
  marginal_rates: {
    plan: "starter",
    queries_per_day: 50000,
    bytes_per_month: 10737418240,
    overage_per_1k_queries: 0.1,
    overage_per_gb: 0.2,
    query_overage_billable: true,
    bytes_overage_billable: true,
  },
  drop_markers: {
    markers: 0,
    truncated: false,
    entries_dropped: 0,
    markers_unparsed: 0,
    reasons: [],
  },
};

/** All human output as one string, for substring assertions. */
function printed(): string {
  return vi
    .mocked(consola.log)
    .mock.calls.map((c) => String(c[0]))
    .join("\n");
}

describe("agents usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveContext).mockReturnValue({
      client: { agents: { getAgentUsageBreakdown: mockGetAgentUsageBreakdown } } as never,
      orgId: "org_123",
      projectId: "prj_1",
    });
    vi.mocked(requireProject).mockReturnValue("prj_1");
    mockGetAgentUsageBreakdown.mockResolvedValue(REPORT);
  });

  it("requests the report for the linked project", async () => {
    await run({ args: { ...baseArgs } } as never);

    expect(mockGetAgentUsageBreakdown).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_1" },
      queryParams: {},
    });
  });

  it("forwards the window filters", async () => {
    await run({
      args: { ...baseArgs, start: "2026-09-01T00:00:00Z", end: "2026-09-08T00:00:00Z" },
    } as never);

    expect(mockGetAgentUsageBreakdown).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_1" },
      queryParams: { start: "2026-09-01T00:00:00Z", end: "2026-09-08T00:00:00Z" },
    });
  });

  it("prints the agent line with its own percentiles", async () => {
    await run({ args: { ...baseArgs } } as never);

    const out = printed();
    expect(out).toContain("agt_one");
    expect(out).toContain("12.5ms");
    expect(out).toContain("40.3ms");
  });

  // The unattributed line is the reason this report exists rather than a plain
  // GROUP BY, so it is printed even when it is zero. Its absence would be
  // indistinguishable from a window that had none.
  it("always prints the unattributed line", async () => {
    mockGetAgentUsageBreakdown.mockResolvedValue({ ...REPORT, unattributed: line() });
    await run({ args: { ...baseArgs } } as never);

    expect(printed()).toContain("(unattributed)");
  });

  // An accumulated line carries no percentile, so the table prints a dash rather
  // than a zero that would read as a measured latency of nothing.
  it("prints a dash rather than zero for accumulated percentiles", async () => {
    await run({ args: { ...baseArgs } } as never);

    const totalsRow = vi
      .mocked(consola.log)
      .mock.calls.map((c) => String(c[0]))
      .find((l) => l.startsWith("(total)"));
    expect(totalsRow).toBeDefined();
    expect(totalsRow).toContain("-");
    expect(totalsRow).not.toContain("0.0ms");
  });

  it("warns that the totals are a floor when the trail lost entries", async () => {
    mockGetAgentUsageBreakdown.mockResolvedValue({
      ...REPORT,
      complete: false,
      drop_markers: {
        markers: 2,
        truncated: false,
        entries_dropped: 140,
        markers_unparsed: 1,
        reasons: ["audit buffer full: 128 entries dropped"],
      },
    });

    await run({ args: { ...baseArgs } } as never);

    const warned = vi
      .mocked(consola.warn)
      .mock.calls.map((c) => String(c[0]))
      .join("\n");
    expect(warned).toContain("2 gap marker(s)");
    expect(warned).toContain("at least 140");
    expect(warned).toContain("1 marker(s) whose count could not be read");
    expect(warned).toContain("floor, not a measurement");
  });

  it("warns when latencies were excluded as non-finite", async () => {
    mockGetAgentUsageBreakdown.mockResolvedValue({
      ...REPORT,
      totals: line({ entries: 13, latency_unmeasured: 4 }),
    });

    await run({ args: { ...baseArgs } } as never);

    const warned = vi
      .mocked(consola.warn)
      .mock.calls.map((c) => String(c[0]))
      .join("\n");
    expect(warned).toContain("4 entr(ies) had a non-finite latency");
  });

  it("emits the raw report under --json", async () => {
    // --json writes to stdout directly rather than through consola, so that a
    // piped caller gets the payload and nothing else.
    const written: string[] = [];
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        written.push(String(chunk));
        return true;
      });

    await run({ args: { ...baseArgs, json: true } } as never);
    spy.mockRestore();

    const out = written.join("");
    expect(out).toContain('"marginal_rates"');
    expect(out).toContain('"query_overage_billable": true');
  });

  it("prints the requested window as well as the covered one", async () => {
    mockGetAgentUsageBreakdown.mockResolvedValue(REPORT);

    await run({ args: { ...baseArgs } } as never);

    // Both parameters are optional, so a caller that pinned neither still has to
    // be told which window the totals cover before reading them as everything.
    expect(printed()).toContain("Requested:");
    expect(printed()).toContain("Covered:");
  });

  it("does not label the entry count as a statement count", async () => {
    mockGetAgentUsageBreakdown.mockResolvedValue(REPORT);

    await run({ args: { ...baseArgs } } as never);

    // entries counts approval progress rows and gap markers too, so a STMTS
    // header would overstate what an agent ran.
    expect(printed()).toContain("ENTRIES");
    expect(printed()).not.toContain("STMTS");
  });

  it("says the marker count is partial when the list was truncated", async () => {
    mockGetAgentUsageBreakdown.mockResolvedValue({
      ...REPORT,
      complete: false,
      drop_markers: {
        markers: 1000,
        truncated: true,
        entries_dropped: 5000,
        markers_unparsed: 0,
        reasons: ["audit buffer full: 5 entries dropped"],
      },
    });

    await run({ args: { ...baseArgs } } as never);

    const warned = vi
      .mocked(consola.warn)
      .mock.calls.map((c) => String(c[0]))
      .join("\n");
    // Printing "1000 gap marker(s)" would read as exact when it is a cap.
    expect(warned).toContain("more than 1000 gap marker(s)");
  });
});
