import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("consola", () => ({
  consola: {
    info: vi.fn(),
    log: vi.fn(),
  },
}));

vi.mock("../../lib/client.js", () => ({
  resolveContext: vi.fn(),
  requireOrg: vi.fn(),
}));

vi.mock("../../lib/errors.js", () => ({
  runCommand: vi.fn(async (fn: () => Promise<void>) => fn()),
}));

vi.mock("../../lib/output.js", () => ({
  output: vi.fn((data: unknown, json: boolean, tableFn?: () => void) => {
    void data;
    if (!json && tableFn) tableFn();
  }),
  outputTable: vi.fn(),
}));

import { consola } from "consola";
import { requireOrg, resolveContext } from "../../lib/client.js";
import { outputTable } from "../../lib/output.js";
import usageCommand from "./usage.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mockClient = {
  analytics: {
    getOrganizationUsage: vi.fn(),
  },
};

function buildArgs(overrides: Record<string, unknown> = {}) {
  return {
    json: false,
    "no-color": false,
    debug: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveContext).mockReturnValue({
    client: mockClient as never,
    orgId: "org-1",
    projectId: null,
  });
  vi.mocked(requireOrg).mockReturnValue("org-1");
});

describe("orgs usage", () => {
  it("calls getOrganizationUsage with the correct org ID", async () => {
    mockClient.analytics.getOrganizationUsage.mockResolvedValue({
      usage: [],
    });

    await usageCommand.run?.({ args: buildArgs() } as never);

    expect(mockClient.analytics.getOrganizationUsage).toHaveBeenCalledWith({
      pathParams: { org_id: "org-1" },
      queryParams: {
        start_date: expect.any(String),
        end_date: expect.any(String),
      },
    });
  });

  it("uses provided start-date and end-date", async () => {
    mockClient.analytics.getOrganizationUsage.mockResolvedValue({
      usage: [],
    });

    await usageCommand.run?.({
      args: buildArgs({
        "start-date": "2025-01-01",
        "end-date": "2025-01-31",
      }),
    } as never);

    expect(mockClient.analytics.getOrganizationUsage).toHaveBeenCalledWith({
      pathParams: { org_id: "org-1" },
      queryParams: {
        start_date: "2025-01-01",
        end_date: "2025-01-31",
      },
    });
  });

  it("shows info message when no usage data is available", async () => {
    mockClient.analytics.getOrganizationUsage.mockResolvedValue({
      usage: [],
    });

    await usageCommand.run?.({ args: buildArgs() } as never);

    expect(consola.info).toHaveBeenCalledWith("No usage data available for this period.");
  });

  it("renders a table and totals for usage data", async () => {
    mockClient.analytics.getOrganizationUsage.mockResolvedValue({
      usage: [
        {
          day: "2025-01-01",
          queries_total: 1000,
          cache_hits: 500,
          bytes_transferred: 1048576,
        },
        {
          day: "2025-01-02",
          queries_total: 2000,
          cache_hits: 1200,
          bytes_transferred: 2097152,
        },
      ],
    });

    await usageCommand.run?.({ args: buildArgs() } as never);

    // Verify totals are displayed
    expect(consola.log).toHaveBeenCalledWith(expect.stringContaining("3,000"));

    // Verify table is rendered
    expect(outputTable).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ day: "2025-01-01" }),
        expect.objectContaining({ day: "2025-01-02" }),
      ]),
      [
        { key: "day", label: "Day" },
        { key: "queries", label: "Queries" },
        { key: "cache_hits", label: "Cache Hits" },
        { key: "data", label: "Data" },
      ],
    );
  });
});
