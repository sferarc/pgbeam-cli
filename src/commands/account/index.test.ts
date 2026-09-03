import { describe, expect, it, vi } from "vitest";

vi.mock("citty", () => ({
  defineCommand: vi.fn((def: Record<string, unknown>) => def),
}));

vi.mock("./export.js", () => ({ default: { meta: { name: "export" } } }));

import accountCommand from "./index.js";

describe("account command", () => {
  it("has correct meta", () => {
    const meta = accountCommand.meta as { name: string; description: string };
    expect(meta.name).toBe("account");
    expect(meta.description).toBe("Manage account settings");
  });

  it("lazy-loads export subcommand", async () => {
    const subCmds = accountCommand.subCommands as Record<string, () => Promise<unknown>>;
    const result = await subCmds.export();
    expect(result).toEqual({ meta: { name: "export" } });
  });
});
