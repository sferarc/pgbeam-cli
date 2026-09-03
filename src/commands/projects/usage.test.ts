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

const mockGetProjectUsage = vi.fn();
vi.mock("../../lib/client.js", () => ({
  resolveContext: vi.fn(),
  requireProject: vi.fn(),
}));

vi.mock("../../lib/errors.js", () => ({
  runCommand: vi.fn(async (fn) => fn()),
}));

vi.mock("../../lib/output.js", () => ({
  output: vi.fn((data, json, tableFn) => {
    void data;
    if (json) return;
    if (tableFn) tableFn();
  }),
  outputTable: vi.fn(),
}));

import { consola } from "consola";
import { requireProject, resolveContext } from "../../lib/client.js";
import { output, outputTable } from "../../lib/output.js";
import usageCommand from "./usage.js";

const run = usageCommand.run;
if (!run) throw new Error("command.run is not defined");

describe("projects usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveContext).mockReturnValue({
      client: {
        analytics: { getProjectUsage: mockGetProjectUsage },
      } as never,
      orgId: "org_123",
      projectId: "prj_1",
    });
    vi.mocked(requireProject).mockReturnValue("prj_1");
  });

  it("fetches usage with explicit date range", async () => {
    mockGetProjectUsage.mockResolvedValue({
      usage: [
        {
          day: "2024-01-01",
          region: "us-east-1",
          queries_total: 100,
          cache_hits: 50,
          bytes_transferred: 1024,
        },
      ],
    });

    await run({
      args: {
        "start-date": "2024-01-01",
        "end-date": "2024-01-31",
        json: false,
        "no-color": false,
        debug: false,
      },
    } as never);

    expect(mockGetProjectUsage).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_1" },
      queryParams: { start_date: "2024-01-01", end_date: "2024-01-31" },
    });
  });

  it("uses default date range when not provided", async () => {
    mockGetProjectUsage.mockResolvedValue({ usage: [] });

    await run({
      args: { json: false, "no-color": false, debug: false },
    } as never);

    expect(mockGetProjectUsage).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_1" },
      queryParams: {
        start_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        end_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      },
    });
  });

  it("shows info message for empty usage data", async () => {
    mockGetProjectUsage.mockResolvedValue({ usage: [] });

    await run({
      args: {
        "start-date": "2024-01-01",
        "end-date": "2024-01-31",
        json: false,
        "no-color": false,
        debug: false,
      },
    } as never);

    expect(consola.info).toHaveBeenCalledWith("No usage data available for this period.");
  });

  it("displays usage table and summary for non-empty data", async () => {
    mockGetProjectUsage.mockResolvedValue({
      usage: [
        {
          day: "2024-01-01",
          region: "us-east-1",
          queries_total: 1000,
          cache_hits: 500,
          bytes_transferred: 1048576,
        },
        {
          day: "2024-01-02",
          region: "us-east-1",
          queries_total: 2000,
          cache_hits: 800,
          bytes_transferred: 2097152,
        },
      ],
    });

    await run({
      args: {
        "start-date": "2024-01-01",
        "end-date": "2024-01-02",
        json: false,
        "no-color": false,
        debug: false,
      },
    } as never);

    expect(consola.log).toHaveBeenCalledWith(expect.stringContaining("Total queries: 3,000"));
    expect(outputTable).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ day: "2024-01-01", region: "us-east-1" })]),
      expect.arrayContaining([
        { key: "day", label: "Day" },
        { key: "queries", label: "Queries" },
      ]),
    );
  });

  it("outputs JSON when --json is set", async () => {
    const result = { usage: [] };
    mockGetProjectUsage.mockResolvedValue(result);

    await run({
      args: {
        "start-date": "2024-01-01",
        "end-date": "2024-01-31",
        json: true,
        "no-color": false,
        debug: false,
      },
    } as never);

    expect(output).toHaveBeenCalledWith(result, true, expect.any(Function));
  });
});
