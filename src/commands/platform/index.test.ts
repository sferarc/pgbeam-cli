import { describe, expect, it, vi } from "vitest";

vi.mock("citty", () => ({
  defineCommand: vi.fn((def: Record<string, unknown>) => def),
}));

vi.mock("../regions.js", () => ({ default: { meta: { name: "regions" } } }));
vi.mock("../health.js", () => ({ default: { meta: { name: "health" } } }));

import platformCommand from "./index.js";

describe("platform command", () => {
  it("has correct meta", () => {
    const meta = platformCommand.meta as { name: string; description: string };
    expect(meta.name).toBe("platform");
    expect(meta.description).toBe("Regions and health checks");
  });

  it("lazy-loads regions subcommand", async () => {
    const subCmds = platformCommand.subCommands as Record<string, () => Promise<unknown>>;
    const result = await subCmds.regions();
    expect(result).toEqual({ meta: { name: "regions" } });
  });

  it("lazy-loads health subcommand", async () => {
    const subCmds = platformCommand.subCommands as Record<string, () => Promise<unknown>>;
    const result = await subCmds.health();
    expect(result).toEqual({ meta: { name: "health" } });
  });
});
