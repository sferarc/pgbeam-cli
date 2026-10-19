import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("consola", () => ({
  consola: {
    success: vi.fn(),
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

import { consola } from "consola";
import { requireProject, resolveContext } from "../../lib/client.js";
import { output } from "../../lib/output.js";
import testCommand from "./test.js";

const mockClient = {
  webhooks: {
    testWebhookEndpoint: vi.fn(),
  },
};

function buildArgs(overrides: Record<string, unknown> = {}) {
  return { json: false, "no-color": false, debug: false, id: "wh-1", ...overrides };
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

describe("webhooks test", () => {
  it("sends a test delivery to the endpoint", async () => {
    mockClient.webhooks.testWebhookEndpoint.mockResolvedValue({ delivered: true });

    await testCommand.run?.({ args: buildArgs() } as never);

    expect(mockClient.webhooks.testWebhookEndpoint).toHaveBeenCalledWith({
      pathParams: { project_id: "proj-1", webhook_id: "wh-1" },
    });
    expect(consola.success).toHaveBeenCalledWith("Test delivery sent to webhook wh-1.");
  });

  it("passes the API result through with --json", async () => {
    const result = { delivered: true, status_code: 200 };
    mockClient.webhooks.testWebhookEndpoint.mockResolvedValue(result);

    await testCommand.run?.({ args: buildArgs({ json: true }) } as never);

    expect(output).toHaveBeenCalledWith(result, true, expect.any(Function));
    expect(consola.success).not.toHaveBeenCalled();
  });

  it("requires a webhook ID", async () => {
    await expect(testCommand.run?.({ args: buildArgs({ id: "" }) } as never)).rejects.toThrow(
      /webhook ID/,
    );
    expect(mockClient.webhooks.testWebhookEndpoint).not.toHaveBeenCalled();
  });
});
