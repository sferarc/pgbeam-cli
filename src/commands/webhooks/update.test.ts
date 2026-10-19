import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("../../lib/stdin.js", () => ({
  readStdin: vi.fn(),
}));

import { consola } from "consola";
import { requireProject, resolveContext } from "../../lib/client.js";
import { readStdin } from "../../lib/stdin.js";
import updateCommand from "./update.js";

const mockClient = {
  webhooks: {
    getWebhookEndpoint: vi.fn(),
    updateWebhookEndpoint: vi.fn(),
  },
};

const current = {
  id: "wh-1",
  project_id: "proj-1",
  url: "https://old.example.com/hook",
  format: "datadog",
  event_types: ["query_blocked", "canary_tripped"],
  enabled: true,
  description: "prod alerts",
};

function buildArgs(overrides: Record<string, unknown> = {}) {
  return {
    json: false,
    "no-color": false,
    debug: false,
    "secret-stdin": false,
    id: "wh-1",
    ...overrides,
  };
}

async function run(overrides: Record<string, unknown> = {}) {
  await updateCommand.run?.({ args: buildArgs(overrides) } as never);
}

function putBody() {
  return mockClient.webhooks.updateWebhookEndpoint.mock.calls[0]?.[0].body;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveContext).mockReturnValue({
    client: mockClient as never,
    orgId: "org-1",
    projectId: "proj-1",
  });
  vi.mocked(requireProject).mockReturnValue("proj-1");
  mockClient.webhooks.getWebhookEndpoint.mockResolvedValue(current);
  mockClient.webhooks.updateWebhookEndpoint.mockResolvedValue(current);
});

describe("webhooks update", () => {
  it("changes only the passed flag and carries every other field from the GET", async () => {
    await run({ url: "https://new.example.com/hook" });

    expect(mockClient.webhooks.getWebhookEndpoint).toHaveBeenCalledWith({
      pathParams: { project_id: "proj-1", webhook_id: "wh-1" },
    });
    expect(mockClient.webhooks.updateWebhookEndpoint).toHaveBeenCalledWith({
      pathParams: { project_id: "proj-1", webhook_id: "wh-1" },
      body: {
        url: "https://new.example.com/hook",
        format: "datadog",
        event_types: ["query_blocked", "canary_tripped"],
        enabled: true,
        description: "prod alerts",
      },
    });
    expect(consola.success).toHaveBeenCalledWith("Webhook wh-1 updated.");
  });

  it("replaces event types and format when given", async () => {
    await run({ event: "masked, kill_switch", format: "elastic" });

    expect(putBody()).toEqual({
      url: "https://old.example.com/hook",
      format: "elastic",
      event_types: ["masked", "kill_switch"],
      enabled: true,
      description: "prod alerts",
    });
  });

  it("disables the endpoint with --enabled=false", async () => {
    await run({ enabled: false });

    expect(putBody()).toMatchObject({ enabled: false, url: current.url });
  });

  it("sets a new description, including an empty one", async () => {
    await run({ description: "" });

    expect(putBody()).toMatchObject({ description: "" });
  });

  it("omits description when the endpoint has none and none is passed", async () => {
    const { description: _, ...withoutDescription } = current;
    mockClient.webhooks.getWebhookEndpoint.mockResolvedValue(withoutDescription);

    await run({ enabled: false });

    expect(putBody()).not.toHaveProperty("description");
  });

  it("rejects an invalid --event before any request", async () => {
    await expect(run({ event: "query.blocked" })).rejects.toThrow(/Invalid event/);

    expect(mockClient.webhooks.getWebhookEndpoint).not.toHaveBeenCalled();
    expect(mockClient.webhooks.updateWebhookEndpoint).not.toHaveBeenCalled();
  });

  it("rejects an invalid --format before any request", async () => {
    await expect(run({ format: "xml" })).rejects.toThrow(/Invalid format/);

    expect(mockClient.webhooks.getWebhookEndpoint).not.toHaveBeenCalled();
    expect(mockClient.webhooks.updateWebhookEndpoint).not.toHaveBeenCalled();
  });

  it("leaves the secret out of the body when none is given so the stored one is kept", async () => {
    await run({ url: "https://new.example.com/hook" });

    expect(putBody()).not.toHaveProperty("secret");
    expect(readStdin).not.toHaveBeenCalled();
  });

  it("sends --secret when given", async () => {
    await run({ secret: "flag-secret" });

    expect(putBody()).toMatchObject({ secret: "flag-secret" });
  });

  it("reads the secret from stdin with --secret-stdin, trimming one trailing newline", async () => {
    vi.mocked(readStdin).mockResolvedValue("piped-secret\n");

    await run({ "secret-stdin": true });

    expect(putBody()).toEqual({
      url: current.url,
      format: current.format,
      event_types: current.event_types,
      enabled: true,
      description: "prod alerts",
      secret: "piped-secret",
    });
  });

  it("rejects an empty secret on stdin before any request", async () => {
    vi.mocked(readStdin).mockResolvedValue("\n");

    await expect(run({ "secret-stdin": true })).rejects.toThrow(/empty secret/);

    expect(mockClient.webhooks.getWebhookEndpoint).not.toHaveBeenCalled();
    expect(mockClient.webhooks.updateWebhookEndpoint).not.toHaveBeenCalled();
  });

  it("rejects --secret combined with --secret-stdin without reading stdin", async () => {
    await expect(run({ secret: "x", "secret-stdin": true })).rejects.toThrow(/not both/);

    expect(readStdin).not.toHaveBeenCalled();
    expect(mockClient.webhooks.updateWebhookEndpoint).not.toHaveBeenCalled();
  });
});
