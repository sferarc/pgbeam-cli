import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("consola", () => ({
  consola: {
    success: vi.fn(),
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

import { consola } from "consola";
import { requireProject, resolveContext } from "../../lib/client.js";
import approveCommand from "./approve.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mockClient = {
  approvals: {
    approveApprovalRequest: vi.fn(),
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

describe("approvals approve", () => {
  it("approves with an empty body when no reason is given", async () => {
    mockClient.approvals.approveApprovalRequest.mockResolvedValue({});

    await approveCommand.run?.({ args: buildArgs({ id: "apr-1" }) } as never);

    expect(mockClient.approvals.approveApprovalRequest).toHaveBeenCalledWith({
      pathParams: { project_id: "proj-1", approval_id: "apr-1" },
      body: {},
    });
    expect(consola.success).toHaveBeenCalledWith("Statement apr-1 approved.");
  });

  it("approves with a reason body when reason is provided", async () => {
    mockClient.approvals.approveApprovalRequest.mockResolvedValue({});

    await approveCommand.run?.({
      args: buildArgs({ id: "apr-2", reason: "verified safe" }),
    } as never);

    expect(mockClient.approvals.approveApprovalRequest).toHaveBeenCalledWith({
      pathParams: { project_id: "proj-1", approval_id: "apr-2" },
      body: { reason: "verified safe" },
    });
    expect(consola.success).toHaveBeenCalledWith("Statement apr-2 approved.");
  });
});
