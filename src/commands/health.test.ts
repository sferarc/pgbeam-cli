import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("citty", () => ({
  defineCommand: (config: Record<string, unknown>) => config,
}));

vi.mock("../lib/flags.js", () => ({
  globalArgs: {},
}));

const mockGetHealth = vi.fn();

vi.mock("pgbeam", () => {
  return {
    PgBeamClient: class MockPgBeamClient {
      api = { platform: { getHealth: mockGetHealth } };
    },
  };
});

vi.mock("../lib/errors.js", () => ({
  runCommand: vi.fn(async (fn: () => Promise<void>) => fn()),
}));

vi.mock("../lib/output.js", () => ({
  output: vi.fn(),
}));

vi.mock("consola", () => ({
  consola: { log: vi.fn() },
}));

import { output } from "../lib/output.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function runHandler(args: Record<string, unknown> = {}) {
  const mod = await import("./health.js");
  const command = mod.default;
  await command.run?.({ args: { json: false, "no-color": false, debug: false, ...args } } as never);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
});

describe("health", () => {
  it("calls getHealth and passes result to output", async () => {
    const result = { status: "ok", version: "1.2.3" };
    mockGetHealth.mockResolvedValue(result);

    await runHandler();

    expect(mockGetHealth).toHaveBeenCalledOnce();
    expect(output).toHaveBeenCalledWith(result, false, expect.any(Function));
  });

  it("passes json=true to output when --json is set", async () => {
    mockGetHealth.mockResolvedValue({ status: "ok", version: "1.0.0" });

    await runHandler({ json: true });

    expect(output).toHaveBeenCalledWith(expect.anything(), true, expect.any(Function));
  });

  it("table callback logs status and version", async () => {
    const result = { status: "ok", version: "1.2.3" };
    mockGetHealth.mockResolvedValue(result);
    await runHandler();

    const { consola } = await import("consola");
    const tableFn = vi.mocked(output).mock.calls[0][2] as () => void;
    tableFn();
    expect(consola.log).toHaveBeenCalledWith(expect.stringContaining("ok"));
    expect(consola.log).toHaveBeenCalledWith(expect.stringContaining("1.2.3"));
  });
});
