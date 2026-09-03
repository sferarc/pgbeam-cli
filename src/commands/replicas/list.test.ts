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

import { resolveContext } from "../../lib/client.js";
import { outputTable } from "../../lib/output.js";
import listCommand from "./list.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mockClient = {
  projects: {
    listReplicas: vi.fn(),
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
});

describe("replicas list", () => {
  it("calls listReplicas with the correct database ID", async () => {
    mockClient.projects.listReplicas.mockResolvedValue({ replicas: [] });

    await listCommand.run?.({
      args: buildArgs({ "database-id": "db-1" }),
    } as never);

    expect(mockClient.projects.listReplicas).toHaveBeenCalledWith({
      pathParams: { database_id: "db-1" },
    });
  });

  it("renders a table with replica data", async () => {
    mockClient.projects.listReplicas.mockResolvedValue({
      replicas: [
        { id: "rep-1", host: "replica1.host.com", port: 5432, ssl_mode: "require" },
        { id: "rep-2", host: "replica2.host.com", port: 5433, ssl_mode: "disable" },
      ],
    });

    await listCommand.run?.({
      args: buildArgs({ "database-id": "db-1" }),
    } as never);

    expect(outputTable).toHaveBeenCalledWith(
      [
        { id: "rep-1", host: "replica1.host.com", port: 5432, ssl: "require" },
        { id: "rep-2", host: "replica2.host.com", port: 5433, ssl: "disable" },
      ],
      [
        { key: "id", label: "ID" },
        { key: "host", label: "Host" },
        { key: "port", label: "Port" },
        { key: "ssl", label: "SSL" },
      ],
    );
  });

  it("throws when database-id is missing", async () => {
    await expect(
      listCommand.run?.({ args: buildArgs({ "database-id": "" }) } as never),
    ).rejects.toThrow("Missing required argument: database-id");
  });
});
