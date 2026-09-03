import { describe, expect, it, vi } from "vitest";

vi.mock("citty", () => ({
  defineCommand: vi.fn((def: Record<string, unknown>) => def),
}));

// Every domains subcommand is generated from the OpenAPI contract; the group
// index composes them via generatedLeaf(), so there are no per-leaf modules to
// mock here.
import domainsCommand from "./index.js";

describe("domains command", () => {
  it("has correct meta", () => {
    const meta = domainsCommand.meta as { name: string; description: string };
    expect(meta.name).toBe("domains");
    expect(meta.description).toBe("Manage custom domains");
  });

  it("lazy-loads all subcommands", async () => {
    const subCmds = domainsCommand.subCommands as Record<string, () => Promise<unknown>>;
    const results = await Promise.all(Object.values(subCmds).map((loader) => loader()));
    expect(results).toHaveLength(7);
    for (const result of results) {
      expect(result).toHaveProperty("meta");
    }
  });
});
