import { describe, expect, it, vi } from "vitest";

vi.mock("citty", () => ({
  defineCommand: vi.fn((def: Record<string, unknown>) => def),
}));

vi.mock("./pull.js", () => ({ default: { meta: { name: "pull" } } }));

import envCommand from "./index.js";

describe("env command", () => {
  it("has correct meta", () => {
    const meta = envCommand.meta as { name: string; description: string };
    expect(meta.name).toBe("env");
    expect(meta.description).toBe("Manage environment variables");
  });

  it("lazy-loads pull subcommand", async () => {
    const subCmds = envCommand.subCommands as Record<string, () => Promise<unknown>>;
    const result = await subCmds.pull();
    expect(result).toEqual({ meta: { name: "pull" } });
  });
});
