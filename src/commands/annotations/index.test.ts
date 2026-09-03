import { describe, expect, it, vi } from "vitest";

vi.mock("citty", () => ({
  defineCommand: vi.fn((def: Record<string, unknown>) => def),
}));

// Every subcommand is generated from the OpenAPI contract (composed via
// generatedLeaf); the group carries no bespoke, hand-authored module.
import annotationsCommand from "./index.js";

describe("annotations command", () => {
  it("has correct meta", () => {
    const meta = annotationsCommand.meta as { name: string; description: string };
    expect(meta.name).toBe("annotations");
    expect(meta.description).toBe("Describe tables and columns for connected agents");
  });

  it("lazy-loads all subcommands", async () => {
    const subCmds = annotationsCommand.subCommands as Record<string, () => Promise<unknown>>;
    const results = await Promise.all(Object.values(subCmds).map((loader) => loader()));
    expect(results).toHaveLength(5);
    for (const result of results) {
      expect(result).toHaveProperty("meta");
    }
  });
});
