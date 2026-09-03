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

vi.mock("../lib/client.js", () => ({
  resolveContext: vi.fn(),
}));

vi.mock("../lib/errors.js", () => ({
  runCommand: vi.fn(async (fn: () => Promise<void>) => fn()),
}));

vi.mock("../lib/output.js", () => ({
  output: vi.fn(),
  outputTable: vi.fn(),
}));

vi.mock("consola", () => ({
  consola: { log: vi.fn() },
}));

import { resolveContext } from "../lib/client.js";
import { output } from "../lib/output.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mockListRegions = vi.fn();

function setupContext() {
  vi.mocked(resolveContext).mockReturnValue({
    client: {
      platform: { listRegions: mockListRegions },
    },
    orgId: "org-1",
    projectId: null,
  } as never);
}

async function runHandler(args: Record<string, unknown> = {}) {
  const mod = await import("./regions.js");
  const command = mod.default;
  await command.run?.({ args: { json: false, "no-color": false, debug: false, ...args } } as never);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
});

describe("regions", () => {
  it("calls listRegions and passes result to output", async () => {
    setupContext();
    const result = {
      regions: [
        { id: "us-east-1", name: "US East", provider: "aws" },
        { id: "eu-west-1", name: "EU West", provider: "aws" },
      ],
    };
    mockListRegions.mockResolvedValue(result);

    await runHandler();

    expect(mockListRegions).toHaveBeenCalledOnce();
    expect(output).toHaveBeenCalledWith(result, false, expect.any(Function));
  });

  it("passes json=true to output when --json is set", async () => {
    setupContext();
    mockListRegions.mockResolvedValue({ regions: [] });

    await runHandler({ json: true });

    expect(output).toHaveBeenCalledWith(expect.anything(), true, expect.any(Function));
  });

  it("table callback formats region rows with outputTable", async () => {
    setupContext();
    const result = {
      regions: [
        { id: "us-east-1", name: "US East", provider: "aws" },
        { id: "eu-west-1", name: "EU West", provider: "aws" },
      ],
    };
    mockListRegions.mockResolvedValue(result);
    await runHandler();

    const { outputTable } = await import("../lib/output.js");
    const tableFn = vi.mocked(output).mock.calls[0][2] as () => void;
    tableFn();
    expect(outputTable).toHaveBeenCalledWith(
      [
        { id: "us-east-1", name: "US East", provider: "aws" },
        { id: "eu-west-1", name: "EU West", provider: "aws" },
      ],
      expect.any(Array),
    );
  });
});
