import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("consola", () => ({
  consola: {
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

vi.mock("../../lib/output.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/output.js")>();
  return {
    sanitizeForTerminal: actual.sanitizeForTerminal,
    formatDate: vi.fn((d: string) => `date(${d})`),
    output: vi.fn((data: unknown, json: boolean, tableFn?: () => void) => {
      void data;
      if (!json && tableFn) tableFn();
    }),
  };
});

import { consola } from "consola";
import { requireProject, resolveContext } from "../../lib/client.js";
import { output } from "../../lib/output.js";
import showCommand from "./show.js";

const mockClient = {
  webhooks: {
    getWebhookEndpoint: vi.fn(),
  },
};

const endpoint = {
  id: "wh-1",
  project_id: "proj-1",
  url: "https://example.com/hook",
  format: "json",
  event_types: ["query_blocked", "masked"],
  enabled: true,
  description: "alerts",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

function buildArgs(overrides: Record<string, unknown> = {}) {
  return { json: false, "no-color": false, debug: false, id: "wh-1", ...overrides };
}

function printed(): string[] {
  return vi.mocked(consola.log).mock.calls.map((c) => String(c[0]));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveContext).mockReturnValue({
    client: mockClient as never,
    orgId: "org-1",
    projectId: "proj-1",
  });
  vi.mocked(requireProject).mockReturnValue("proj-1");
});

describe("webhooks show", () => {
  it("fetches the endpoint and prints each field", async () => {
    mockClient.webhooks.getWebhookEndpoint.mockResolvedValue(endpoint);

    await showCommand.run?.({ args: buildArgs() } as never);

    expect(mockClient.webhooks.getWebhookEndpoint).toHaveBeenCalledWith({
      pathParams: { project_id: "proj-1", webhook_id: "wh-1" },
    });
    expect(printed()).toEqual([
      "ID:          wh-1",
      "Project:     proj-1",
      "URL:         https://example.com/hook",
      "Format:      json",
      "Events:      query_blocked, masked",
      "Enabled:     yes",
      "Description: alerts",
      "Created:     date(2026-01-01T00:00:00Z)",
      "Updated:     date(2026-01-02T00:00:00Z)",
    ]);
  });

  it("shows 'all' for no event filter and '-' for no description", async () => {
    mockClient.webhooks.getWebhookEndpoint.mockResolvedValue({
      ...endpoint,
      event_types: [],
      enabled: false,
      description: undefined,
    });

    await showCommand.run?.({ args: buildArgs() } as never);

    expect(printed()).toContain("Events:      all");
    expect(printed()).toContain("Enabled:     no");
    expect(printed()).toContain("Description: -");
  });

  it("strips terminal escape sequences from server-controlled fields", async () => {
    mockClient.webhooks.getWebhookEndpoint.mockResolvedValue({
      ...endpoint,
      url: "https://example.com/\u001b[2Jhook",
    });

    await showCommand.run?.({ args: buildArgs() } as never);

    expect(printed().join("\n")).not.toContain("\u001b");
  });

  it("passes the raw object through with --json", async () => {
    mockClient.webhooks.getWebhookEndpoint.mockResolvedValue(endpoint);

    await showCommand.run?.({ args: buildArgs({ json: true }) } as never);

    expect(output).toHaveBeenCalledWith(endpoint, true, expect.any(Function));
    expect(consola.log).not.toHaveBeenCalled();
  });
});
