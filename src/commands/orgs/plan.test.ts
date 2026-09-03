import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("consola", () => ({
  consola: {
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
  formatDate: vi.fn((value: unknown) => String(value ?? "-")),
}));

import { consola } from "consola";
import { requireOrg, resolveContext } from "../../lib/client.js";
import planCommand from "./plan.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mockClient = {
  analytics: {
    getOrganizationPlan: vi.fn(),
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

describe("orgs plan", () => {
  it("calls getOrganizationPlan with the correct org ID", async () => {
    mockClient.analytics.getOrganizationPlan.mockResolvedValue({
      org_id: "org-1",
      plan: "pro",
      subscription_status: "active",
      enabled: true,
      current_period_end: "2025-02-01T00:00:00Z",
      limits: {
        max_projects: 10,
        max_databases: 50,
        max_connections: 1000,
        queries_per_day: 100000,
        queries_per_second: 50,
      },
    });

    await planCommand.run?.({ args: buildArgs() } as never);

    expect(mockClient.analytics.getOrganizationPlan).toHaveBeenCalledWith({
      pathParams: { org_id: "org-1" },
    });
  });

  it("displays plan details", async () => {
    mockClient.analytics.getOrganizationPlan.mockResolvedValue({
      org_id: "org-1",
      plan: "pro",
      subscription_status: "active",
      enabled: true,
      current_period_end: "2025-02-01T00:00:00Z",
      limits: {
        max_projects: 10,
        max_databases: 50,
        max_connections: 1000,
        queries_per_day: 100000,
        queries_per_second: 50,
      },
    });

    await planCommand.run?.({ args: buildArgs() } as never);

    expect(consola.log).toHaveBeenCalledWith("Organization: org-1");
    expect(consola.log).toHaveBeenCalledWith("Plan:         pro");
    expect(consola.log).toHaveBeenCalledWith("Status:       active");
    expect(consola.log).toHaveBeenCalledWith("Enabled:      true");
    expect(consola.log).toHaveBeenCalledWith(expect.stringContaining("Projects:     10"));
    expect(consola.log).toHaveBeenCalledWith(expect.stringContaining("Databases:    50"));
    expect(consola.log).toHaveBeenCalledWith(expect.stringContaining("Connections:  1000"));
    expect(consola.log).toHaveBeenCalledWith(expect.stringContaining("Queries/sec:  50"));
  });

  it("shows 'unlimited' for zero queries_per_day", async () => {
    mockClient.analytics.getOrganizationPlan.mockResolvedValue({
      org_id: "org-1",
      plan: "enterprise",
      subscription_status: "active",
      enabled: true,
      limits: {
        max_projects: 100,
        max_databases: 500,
        max_connections: 10000,
        queries_per_day: 0,
        queries_per_second: 200,
      },
    });

    await planCommand.run?.({ args: buildArgs() } as never);

    expect(consola.log).toHaveBeenCalledWith(expect.stringContaining("Queries/day:  unlimited"));
  });

  it("shows 'none' when subscription_status is null", async () => {
    mockClient.analytics.getOrganizationPlan.mockResolvedValue({
      org_id: "org-1",
      plan: "free",
      subscription_status: null,
      enabled: true,
      limits: {
        max_projects: 1,
        max_databases: 1,
        max_connections: 10,
        queries_per_day: 1000,
        queries_per_second: 5,
      },
    });

    await planCommand.run?.({ args: buildArgs() } as never);

    expect(consola.log).toHaveBeenCalledWith("Status:       none");
  });
});
