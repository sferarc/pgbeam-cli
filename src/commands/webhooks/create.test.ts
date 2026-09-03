import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(),
}));

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

vi.mock("../../lib/output.js", () => ({
  output: vi.fn((data: unknown, json: boolean, tableFn?: () => void) => {
    void data;
    if (!json && tableFn) tableFn();
  }),
}));

import { input } from "@inquirer/prompts";
import { consola } from "consola";
import { requireProject, resolveContext } from "../../lib/client.js";
import createCommand from "./create.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mockClient = {
  webhooks: {
    createWebhookEndpoint: vi.fn(),
  },
};

function buildArgs(overrides: Record<string, unknown> = {}) {
  return {
    json: false,
    "no-color": false,
    debug: false,
    format: "json",
    disabled: false,
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

describe("webhooks create", () => {
  it("creates a webhook with the positional url and defaults", async () => {
    mockClient.webhooks.createWebhookEndpoint.mockResolvedValue({
      id: "wh-1",
      url: "https://example.com/hook",
    });

    await createCommand.run?.({
      args: buildArgs({ url: "https://example.com/hook" }),
    } as never);

    expect(mockClient.webhooks.createWebhookEndpoint).toHaveBeenCalledWith({
      pathParams: { project_id: "proj-1" },
      body: { url: "https://example.com/hook", format: "json", enabled: true },
    });
    expect(consola.success).toHaveBeenCalledWith("Webhook created: wh-1");
  });

  it("prompts for the url when not provided", async () => {
    vi.mocked(input).mockResolvedValue("https://prompted.com/hook");
    mockClient.webhooks.createWebhookEndpoint.mockResolvedValue({
      id: "wh-2",
      url: "https://prompted.com/hook",
    });

    await createCommand.run?.({ args: buildArgs() } as never);

    expect(input).toHaveBeenCalledWith({ message: "Webhook URL:" });
    expect(mockClient.webhooks.createWebhookEndpoint).toHaveBeenCalledWith({
      pathParams: { project_id: "proj-1" },
      body: { url: "https://prompted.com/hook", format: "json", enabled: true },
    });
  });

  it("parses comma-separated events and includes optional fields", async () => {
    mockClient.webhooks.createWebhookEndpoint.mockResolvedValue({
      id: "wh-3",
      url: "https://example.com/hook",
    });

    await createCommand.run?.({
      args: buildArgs({
        url: "https://example.com/hook",
        format: "datadog",
        event: "query.blocked, policy.updated ,",
        secret: "s3cr3t",
        description: "my hook",
        disabled: true,
      }),
    } as never);

    expect(mockClient.webhooks.createWebhookEndpoint).toHaveBeenCalledWith({
      pathParams: { project_id: "proj-1" },
      body: {
        url: "https://example.com/hook",
        format: "datadog",
        enabled: false,
        event_types: ["query.blocked", "policy.updated"],
        secret: "s3cr3t",
        description: "my hook",
      },
    });
  });

  it("outputs JSON when --json flag is set", async () => {
    const result = { id: "wh-4", url: "https://json.com/hook" };
    mockClient.webhooks.createWebhookEndpoint.mockResolvedValue(result);

    const { output } = await import("../../lib/output.js");
    await createCommand.run?.({
      args: buildArgs({ url: "https://json.com/hook", json: true }),
    } as never);

    expect(output).toHaveBeenCalledWith(result, true, expect.any(Function));
  });
});
