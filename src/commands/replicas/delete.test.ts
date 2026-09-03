import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("../../lib/confirm.js", () => ({
  confirmDestructive: vi.fn(),
  ConfirmationDeclinedError: class extends Error {},
}));

vi.mock("consola", () => ({
  consola: {
    success: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("../../lib/client.js", () => ({
  resolveContext: vi.fn(),
}));

vi.mock("../../lib/errors.js", () => ({
  runCommand: vi.fn(async (fn: () => Promise<void>) => fn()),
}));

import { consola } from "consola";
import { resolveContext } from "../../lib/client.js";
import { ConfirmationDeclinedError, confirmDestructive } from "../../lib/confirm.js";
import deleteCommand from "./delete.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mockClient = {
  projects: {
    deleteReplica: vi.fn(),
  },
};

function buildArgs(overrides: Record<string, unknown> = {}) {
  return {
    json: false,
    "no-color": false,
    debug: false,
    yes: false,
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
  vi.mocked(confirmDestructive).mockResolvedValue();
});

describe("replicas delete", () => {
  it("deletes with --yes flag (forwarded to confirmDestructive)", async () => {
    mockClient.projects.deleteReplica.mockResolvedValue(undefined);

    await deleteCommand.run?.({
      args: buildArgs({ "database-id": "db-1", id: "rep-1", yes: true }),
    } as never);

    expect(confirmDestructive).toHaveBeenCalledWith(expect.objectContaining({ yes: true }));
    expect(mockClient.projects.deleteReplica).toHaveBeenCalledWith({
      pathParams: { database_id: "db-1", replica_id: "rep-1" },
    });
    expect(consola.success).toHaveBeenCalledWith("Replica rep-1 deleted.");
  });

  it("confirms then deletes when user confirms", async () => {
    mockClient.projects.deleteReplica.mockResolvedValue(undefined);

    await deleteCommand.run?.({
      args: buildArgs({ "database-id": "db-1", id: "rep-2" }),
    } as never);

    expect(confirmDestructive).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Delete replica rep-2? This cannot be undone." }),
    );
    expect(mockClient.projects.deleteReplica).toHaveBeenCalledWith({
      pathParams: { database_id: "db-1", replica_id: "rep-2" },
    });
    expect(consola.success).toHaveBeenCalledWith("Replica rep-2 deleted.");
  });

  it("does not delete when confirmation is declined", async () => {
    vi.mocked(confirmDestructive).mockRejectedValue(new ConfirmationDeclinedError());

    await expect(
      deleteCommand.run?.({
        args: buildArgs({ "database-id": "db-1", id: "rep-3" }),
      } as never),
    ).rejects.toBeInstanceOf(ConfirmationDeclinedError);

    expect(mockClient.projects.deleteReplica).not.toHaveBeenCalled();
  });

  it("throws when database-id is missing", async () => {
    await expect(
      deleteCommand.run?.({
        args: buildArgs({ "database-id": "", id: "rep-1", yes: true }),
      } as never),
    ).rejects.toThrow("Missing required argument: database-id");
  });

  it("throws when replica ID is missing", async () => {
    await expect(
      deleteCommand.run?.({
        args: buildArgs({ "database-id": "db-1", id: "", yes: true }),
      } as never),
    ).rejects.toThrow("Missing required argument: replica ID");
  });
});
