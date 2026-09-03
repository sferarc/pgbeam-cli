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
const mockListPlans = vi.fn();

function setupContext() {
  vi.mocked(resolveContext).mockReturnValue({
    client: {
      analytics: { listPlans: mockListPlans },
    },
    orgId: "org-1",
    projectId: null,
  } as never);
}

async function runHandler(args: Record<string, unknown> = {}) {
  const mod = await import("./plans.js");
  const command = mod.default;
  await command.run?.({ args: { json: false, "no-color": false, debug: false, ...args } } as never);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
});

describe("plans", () => {
  it("calls listPlans and passes result to output", async () => {
    setupContext();
    const result = {
      plans: [
        {
          name: "free",
          label: "Free",
          monthly_price: 0,
          limits: {
            max_projects: 1,
            max_databases: 1,
            max_connections: 10,
            queries_per_day: 1000,
          },
        },
        {
          name: "pro",
          label: "Pro",
          monthly_price: 29,
          limits: {
            max_projects: 10,
            max_databases: 10,
            max_connections: 100,
            queries_per_day: 0,
          },
        },
      ],
    };
    mockListPlans.mockResolvedValue(result);

    await runHandler();

    expect(mockListPlans).toHaveBeenCalledOnce();
    expect(output).toHaveBeenCalledWith(result, false, expect.any(Function));
  });

  it("passes json=true to output when --json is set", async () => {
    setupContext();
    mockListPlans.mockResolvedValue({ plans: [] });

    await runHandler({ json: true });

    expect(output).toHaveBeenCalledWith(expect.anything(), true, expect.any(Function));
  });

  it("table callback formats plan rows with outputTable", async () => {
    setupContext();
    const result = {
      plans: [
        {
          name: "free",
          label: "Free",
          monthly_price: 0,
          limits: {
            max_projects: 1,
            max_databases: 1,
            max_connections: 10,
            queries_per_day: 1000,
          },
        },
        {
          name: "pro",
          label: "Pro",
          monthly_price: 29,
          limits: {
            max_projects: 10,
            max_databases: 10,
            max_connections: 100,
            queries_per_day: 0,
          },
        },
      ],
    };
    mockListPlans.mockResolvedValue(result);
    await runHandler();

    const { outputTable } = await import("../lib/output.js");
    const tableFn = vi.mocked(output).mock.calls[0][2] as () => void;
    tableFn();
    expect(outputTable).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: "free", price: "$0/mo", queries_day: "1,000" }),
        expect.objectContaining({ name: "pro", price: "$29/mo", queries_day: "unlimited" }),
      ]),
      expect.any(Array),
    );
  });
});
