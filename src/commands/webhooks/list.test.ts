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
}));

import { requireProject, resolveContext } from "../../lib/client.js";
import { outputTable } from "../../lib/output.js";
import listCommand from "./list.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mockClient = {
  webhooks: {
    listWebhookEndpoints: vi.fn(),
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

describe("webhooks list", () => {
  it("calls listWebhookEndpoints with the correct project ID", async () => {
    mockClient.webhooks.listWebhookEndpoints.mockResolvedValue({ webhooks: [] });

    await listCommand.run?.({ args: buildArgs() } as never);

    expect(mockClient.webhooks.listWebhookEndpoints).toHaveBeenCalledWith({
      pathParams: { project_id: "proj-1" },
    });
  });

  it("renders a table with webhook data", async () => {
    mockClient.webhooks.listWebhookEndpoints.mockResolvedValue({
      webhooks: [
        {
          id: "wh-1",
          url: "https://a.com/hook",
          format: "json",
          enabled: true,
          event_types: ["query.blocked", "policy.updated"],
        },
        {
          id: "wh-2",
          url: "https://b.com/hook",
          format: "datadog",
          enabled: false,
        },
      ],
    });

    await listCommand.run?.({ args: buildArgs() } as never);

    expect(outputTable).toHaveBeenCalledWith(
      [
        {
          id: "wh-1",
          url: "https://a.com/hook",
          format: "json",
          enabled: "yes",
          events: "query.blocked,policy.updated",
        },
        {
          id: "wh-2",
          url: "https://b.com/hook",
          format: "datadog",
          enabled: "no",
          events: "all",
        },
      ],
      [
        { key: "id", label: "ID" },
        { key: "url", label: "URL" },
        { key: "format", label: "Format" },
        { key: "enabled", label: "Enabled" },
        { key: "events", label: "Events" },
      ],
    );
  });

  it("shows 'all' for events when event_types is empty", async () => {
    mockClient.webhooks.listWebhookEndpoints.mockResolvedValue({
      webhooks: [
        { id: "wh-1", url: "https://c.com/hook", format: "json", enabled: true, event_types: [] },
      ],
    });

    await listCommand.run?.({ args: buildArgs() } as never);

    expect(outputTable).toHaveBeenCalledWith(
      [
        {
          id: "wh-1",
          url: "https://c.com/hook",
          format: "json",
          enabled: "yes",
          events: "all",
        },
      ],
      expect.any(Array),
    );
  });
});
