import { describe, expect, it, vi } from "vitest";

vi.mock("citty", () => ({
  defineCommand: vi.fn((def: Record<string, unknown>) => def),
}));

// list, inspect, delete, test, scan-pii, and schema-catalog are generated from
// the OpenAPI contract (composed via generatedLeaf); only add and update remain
// bespoke, hand-authored modules.
vi.mock("./add.js", () => ({ default: { meta: { name: "add" } } }));
vi.mock("./update.js", () => ({ default: { meta: { name: "update" } } }));

import dbCommand from "./index.js";

describe("db command", () => {
  it("has correct meta", () => {
    const meta = dbCommand.meta as { name: string; description: string };
    expect(meta.name).toBe("db");
    expect(meta.description).toBe("Manage databases");
  });

  it("lazy-loads all subcommands", async () => {
    const subCmds = dbCommand.subCommands as Record<string, () => Promise<unknown>>;
    const results = await Promise.all(Object.values(subCmds).map((loader) => loader()));
    expect(results).toHaveLength(12);
    for (const result of results) {
      expect(result).toHaveProperty("meta");
    }
  });
});
