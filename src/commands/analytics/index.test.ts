import { describe, expect, it, vi } from "vitest";

vi.mock("citty", () => ({
  defineCommand: vi.fn((def: Record<string, unknown>) => def),
}));

// Mock the lazy-loaded subcommands
vi.mock("../metrics.js", () => ({ default: { meta: { name: "metrics" } } }));
vi.mock("../insights.js", () => ({ default: { meta: { name: "insights" } } }));
vi.mock("../plans.js", () => ({ default: { meta: { name: "plans" } } }));

import analyticsCommand from "./index.js";

describe("analytics command", () => {
  it("has correct meta", () => {
    const meta = analyticsCommand.meta as { name: string; description: string };
    expect(meta.name).toBe("analytics");
    expect(meta.description).toBe("Metrics, insights, and plans");
  });

  it("has metrics, insights, and plans subcommands", () => {
    const subCmds = analyticsCommand.subCommands as Record<string, unknown>;
    expect(subCmds).toHaveProperty("metrics");
    expect(subCmds).toHaveProperty("insights");
    expect(subCmds).toHaveProperty("plans");
  });

  it("lazy-loads metrics subcommand", async () => {
    const subCmds = analyticsCommand.subCommands as Record<string, () => Promise<unknown>>;
    const result = await subCmds.metrics();
    expect(result).toEqual({ meta: { name: "metrics" } });
  });

  it("lazy-loads insights subcommand", async () => {
    const subCmds = analyticsCommand.subCommands as Record<string, () => Promise<unknown>>;
    const result = await subCmds.insights();
    expect(result).toEqual({ meta: { name: "insights" } });
  });

  it("lazy-loads plans subcommand", async () => {
    const subCmds = analyticsCommand.subCommands as Record<string, () => Promise<unknown>>;
    const result = await subCmds.plans();
    expect(result).toEqual({ meta: { name: "plans" } });
  });
});
