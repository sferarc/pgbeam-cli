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
  requireProject: vi.fn(),
}));

vi.mock("../../lib/errors.js", () => ({
  runCommand: vi.fn(async (fn: () => Promise<void>) => fn()),
}));

import { consola } from "consola";
import { requireProject, resolveContext } from "../../lib/client.js";
import { ConfirmationDeclinedError, confirmDestructive } from "../../lib/confirm.js";
import deleteCommand from "./delete.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mockClient = {
  webhooks: {
    deleteWebhookEndpoint: vi.fn(),
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
  vi.mocked(requireProject).mockReturnValue("proj-1");
  vi.mocked(confirmDestructive).mockResolvedValue();
});

describe("webhooks delete", () => {
  it("deletes with --yes flag (forwarded to confirmDestructive)", async () => {
    mockClient.webhooks.deleteWebhookEndpoint.mockResolvedValue(undefined);

    await deleteCommand.run?.({ args: buildArgs({ id: "wh-1", yes: true }) } as never);

    expect(confirmDestructive).toHaveBeenCalledWith(expect.objectContaining({ yes: true }));
    expect(mockClient.webhooks.deleteWebhookEndpoint).toHaveBeenCalledWith({
      pathParams: { project_id: "proj-1", webhook_id: "wh-1" },
    });
    expect(consola.success).toHaveBeenCalledWith("Webhook wh-1 deleted.");
  });

  it("confirms then deletes when user confirms", async () => {
    mockClient.webhooks.deleteWebhookEndpoint.mockResolvedValue(undefined);

    await deleteCommand.run?.({ args: buildArgs({ id: "wh-2" }) } as never);

    expect(confirmDestructive).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Delete webhook wh-2? This cannot be undone." }),
    );
    expect(mockClient.webhooks.deleteWebhookEndpoint).toHaveBeenCalled();
    expect(consola.success).toHaveBeenCalledWith("Webhook wh-2 deleted.");
  });

  it("does not delete when confirmation is declined", async () => {
    vi.mocked(confirmDestructive).mockRejectedValue(new ConfirmationDeclinedError());

    await expect(
      deleteCommand.run?.({ args: buildArgs({ id: "wh-3" }) } as never),
    ).rejects.toBeInstanceOf(ConfirmationDeclinedError);

    expect(mockClient.webhooks.deleteWebhookEndpoint).not.toHaveBeenCalled();
  });

  it("throws when webhook ID is missing", async () => {
    await expect(deleteCommand.run?.({ args: buildArgs({ id: "" }) } as never)).rejects.toThrow(
      "Missing required argument: webhook ID",
    );
  });
});
