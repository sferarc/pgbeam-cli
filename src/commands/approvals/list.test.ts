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
  requireProject: vi.fn(),
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
  formatDate: vi.fn((value: unknown) => String(value ?? "-")),
}));

import { requireProject, resolveContext } from "../../lib/client.js";
import { outputTable } from "../../lib/output.js";
import listCommand from "./list.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mockClient = {
  approvals: {
    listApprovalRequests: vi.fn(),
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
    projectId: "proj-1",
  });
  vi.mocked(requireProject).mockReturnValue("proj-1");
});

describe("approvals list", () => {
  it("calls listApprovalRequests without status filter", async () => {
    mockClient.approvals.listApprovalRequests.mockResolvedValue({ approvals: [] });

    await listCommand.run?.({ args: buildArgs() } as never);

    expect(mockClient.approvals.listApprovalRequests).toHaveBeenCalledWith({
      pathParams: { project_id: "proj-1" },
      queryParams: { page_size: 50 },
    });
  });

  it("includes status in queryParams when provided", async () => {
    mockClient.approvals.listApprovalRequests.mockResolvedValue({ approvals: [] });

    await listCommand.run?.({ args: buildArgs({ status: "pending" }) } as never);

    expect(mockClient.approvals.listApprovalRequests).toHaveBeenCalledWith({
      pathParams: { project_id: "proj-1" },
      queryParams: { page_size: 50, status: "pending" },
    });
  });

  it("renders a table with approval data", async () => {
    mockClient.approvals.listApprovalRequests.mockResolvedValue({
      approvals: [
        {
          id: "apr-1",
          project_id: "proj-1",
          policy_profile_id: "pol-1",
          sql: "SELECT 1",
          statement_kind: "select",
          status: "pending",
          requested_at: "2025-01-15T00:00:00Z",
        },
      ],
    });

    await listCommand.run?.({ args: buildArgs() } as never);

    expect(outputTable).toHaveBeenCalledWith(
      [
        {
          id: "apr-1",
          kind: "select",
          status: "pending",
          requested: "2025-01-15T00:00:00Z",
          sql: "SELECT 1",
        },
      ],
      [
        { key: "id", label: "ID" },
        { key: "kind", label: "Kind" },
        { key: "status", label: "Status" },
        { key: "requested", label: "Requested" },
        { key: "sql", label: "SQL" },
      ],
    );
  });

  it("falls back to '—' for missing statement_kind and truncates SQL", async () => {
    const longSql = `UPDATE users SET name = 'x'\nWHERE id IN (1, 2, 3, 4, 5, 6, 7, 8, 9, 10)`;
    mockClient.approvals.listApprovalRequests.mockResolvedValue({
      approvals: [
        {
          id: "apr-2",
          project_id: "proj-1",
          policy_profile_id: "pol-1",
          sql: longSql,
          status: "pending",
          requested_at: "2025-02-01T00:00:00Z",
        },
      ],
    });

    await listCommand.run?.({ args: buildArgs() } as never);

    const rows = vi.mocked(outputTable).mock.calls[0][0] as Record<string, unknown>[];
    expect(rows[0].kind).toBe("—");
    expect(String(rows[0].sql)).not.toContain("\n");
    expect(String(rows[0].sql).length).toBeLessThanOrEqual(50);
    expect(String(rows[0].sql).endsWith("…")).toBe(true);
  });

  it("outputs JSON when --json flag is set", async () => {
    const result = { approvals: [] };
    mockClient.approvals.listApprovalRequests.mockResolvedValue(result);

    const { output } = await import("../../lib/output.js");
    await listCommand.run?.({ args: buildArgs({ json: true }) } as never);

    expect(output).toHaveBeenCalledWith(result, true, expect.any(Function));
  });
});
