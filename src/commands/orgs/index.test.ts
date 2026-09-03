import { describe, expect, it, vi } from "vitest";

vi.mock("citty", () => ({
  defineCommand: vi.fn((def: Record<string, unknown>) => def),
}));

vi.mock("./list.js", () => ({ default: { meta: { name: "list" } } }));
vi.mock("./switch.js", () => ({ default: { meta: { name: "switch" } } }));
vi.mock("./usage.js", () => ({ default: { meta: { name: "usage" } } }));
vi.mock("./plan.js", () => ({ default: { meta: { name: "plan" } } }));

import orgsCommand from "./index.js";

describe("orgs command", () => {
  it("has correct meta", () => {
    const meta = orgsCommand.meta as { name: string; description: string };
    expect(meta.name).toBe("orgs");
    expect(meta.description).toBe("Manage organizations");
  });

  it("lazy-loads all subcommands", async () => {
    const subCmds = orgsCommand.subCommands as Record<string, () => Promise<unknown>>;
    const results = await Promise.all(Object.values(subCmds).map((loader) => loader()));
    expect(results).toHaveLength(5);
  });
});
