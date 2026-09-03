import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("consola", () => ({
  consola: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    log: vi.fn(),
  },
}));

vi.mock("../../lib/client.js", () => ({
  resolveContext: vi.fn(),
  requireOrg: vi.fn(),
}));

vi.mock("../../lib/errors.js", () => ({
  runCommand: vi.fn(async (fn) => fn()),
}));

vi.mock("../../lib/output.js", () => ({
  output: vi.fn((data: unknown, json: boolean, tableFn?: () => void) => {
    void data;
    if (!json && tableFn) tableFn();
  }),
}));

import { consola } from "consola";
import { requireOrg, resolveContext } from "../../lib/client.js";
import spendLimitCommand from "./spend-limit.js";

const run = spendLimitCommand.run;
if (!run) throw new Error("command.run is not defined");

const mockUpdateSpendLimit = vi.fn();

function buildArgs(overrides: Record<string, unknown> = {}) {
  return { remove: false, json: false, "no-color": false, debug: false, ...overrides };
}

describe("analytics spend-limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveContext).mockReturnValue({
      client: { analytics: { updateSpendLimit: mockUpdateSpendLimit } } as never,
      orgId: "org_123",
      projectId: null,
    });
    vi.mocked(requireOrg).mockReturnValue("org_123");
    mockUpdateSpendLimit.mockResolvedValue({ spend_limit: 250 });
  });

  it("sets a numeric cap", async () => {
    await run({ args: buildArgs({ amount: "250" }) } as never);

    expect(mockUpdateSpendLimit).toHaveBeenCalledWith({
      pathParams: { org_id: "org_123" },
      body: { spend_limit: 250 },
    });
    expect(consola.success).toHaveBeenCalledWith("Spend cap set to $250.00/mo.");
  });

  it("removes the cap with --remove", async () => {
    mockUpdateSpendLimit.mockResolvedValue({ spend_limit: null });
    await run({ args: buildArgs({ remove: true }) } as never);

    expect(mockUpdateSpendLimit).toHaveBeenCalledWith({
      pathParams: { org_id: "org_123" },
      body: { spend_limit: null },
    });
    expect(consola.success).toHaveBeenCalledWith("Spend cap removed.");
  });

  it("throws when neither amount nor --remove provided", async () => {
    await expect(run({ args: buildArgs() } as never)).rejects.toThrow(/spend cap amount/i);
    expect(mockUpdateSpendLimit).not.toHaveBeenCalled();
  });

  it("rejects invalid amounts", async () => {
    await expect(run({ args: buildArgs({ amount: "abc" }) } as never)).rejects.toThrow(
      /Invalid amount/,
    );
    expect(mockUpdateSpendLimit).not.toHaveBeenCalled();
  });
});
