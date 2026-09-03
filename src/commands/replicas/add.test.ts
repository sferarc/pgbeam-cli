import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(),
  select: vi.fn(),
}));

vi.mock("consola", () => ({
  consola: {
    success: vi.fn(),
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
}));

import { input, select } from "@inquirer/prompts";
import { consola } from "consola";
import { resolveContext } from "../../lib/client.js";
import addCommand from "./add.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mockClient = {
  projects: {
    createReplica: vi.fn(),
  },
};

function buildArgs(overrides: Record<string, unknown> = {}) {
  return {
    json: false,
    "no-color": false,
    debug: false,
    port: "5432",
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

describe("replicas add", () => {
  it("creates a replica with all args provided", async () => {
    mockClient.projects.createReplica.mockResolvedValue({ id: "rep-1" });

    await addCommand.run?.({
      args: buildArgs({
        "database-id": "db-1",
        host: "replica.host.com",
        port: "5433",
        "ssl-mode": "require",
      }),
    } as never);

    expect(mockClient.projects.createReplica).toHaveBeenCalledWith({
      pathParams: { database_id: "db-1" },
      body: {
        host: "replica.host.com",
        port: 5433,
        ssl_mode: "require",
      },
    });
    expect(consola.success).toHaveBeenCalledWith("Replica added: rep-1");
  });

  it("prompts for host when not provided", async () => {
    vi.mocked(input).mockResolvedValue("prompted.host.com");
    vi.mocked(select).mockResolvedValue("require");
    mockClient.projects.createReplica.mockResolvedValue({ id: "rep-2" });

    await addCommand.run?.({
      args: buildArgs({ "database-id": "db-1" }),
    } as never);

    expect(input).toHaveBeenCalledWith({ message: "Replica host:" });
    expect(mockClient.projects.createReplica).toHaveBeenCalledWith({
      pathParams: { database_id: "db-1" },
      body: {
        host: "prompted.host.com",
        port: 5432,
        ssl_mode: "require",
      },
    });
  });

  it("prompts for ssl-mode when not provided", async () => {
    vi.mocked(select).mockResolvedValue("verify-full");
    mockClient.projects.createReplica.mockResolvedValue({ id: "rep-3" });

    await addCommand.run?.({
      args: buildArgs({ "database-id": "db-1", host: "host.com" }),
    } as never);

    expect(select).toHaveBeenCalledWith(expect.objectContaining({ message: "SSL mode:" }));
    expect(mockClient.projects.createReplica).toHaveBeenCalledWith({
      pathParams: { database_id: "db-1" },
      body: {
        host: "host.com",
        port: 5432,
        ssl_mode: "verify-full",
      },
    });
  });

  it("throws when database-id is missing", async () => {
    await expect(
      addCommand.run?.({ args: buildArgs({ "database-id": "" }) } as never),
    ).rejects.toThrow("Missing required argument: database-id");
  });

  it("throws for invalid ssl-mode value", async () => {
    await expect(
      addCommand.run?.({
        args: buildArgs({
          "database-id": "db-1",
          host: "host.com",
          "ssl-mode": "invalid",
        }),
      } as never),
    ).rejects.toThrow('Invalid ssl-mode: "invalid"');
  });

  it("throws for invalid port value", async () => {
    vi.mocked(select).mockResolvedValue("require");
    await expect(
      addCommand.run?.({
        args: buildArgs({
          "database-id": "db-1",
          host: "host.com",
          port: "abc",
        }),
      } as never),
    ).rejects.toThrow('Invalid port: "abc" is not a number');
  });
});
