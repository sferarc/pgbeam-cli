import { describe, expect, it, vi } from "vitest";

vi.mock("citty", () => ({
  defineCommand: vi.fn((def: Record<string, unknown>) => def),
}));

vi.mock("./list.js", () => ({ default: { meta: { name: "list" } } }));
vi.mock("./set.js", () => ({ default: { meta: { name: "set" } } }));

import cacheRulesCommand from "./index.js";

describe("cache-rules command", () => {
  it("has correct meta", () => {
    const meta = cacheRulesCommand.meta as { name: string; description: string };
    expect(meta.name).toBe("cache-rules");
    expect(meta.description).toBe("Manage cache rules for query caching");
  });

  it("lazy-loads all subcommands", async () => {
    const subCmds = cacheRulesCommand.subCommands as Record<string, () => Promise<unknown>>;
    const results = await Promise.all(Object.values(subCmds).map((loader) => loader()));
    expect(results).toHaveLength(3);
  });
});
