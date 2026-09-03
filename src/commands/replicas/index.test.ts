import { describe, expect, it, vi } from "vitest";

vi.mock("citty", () => ({
  defineCommand: vi.fn((def: Record<string, unknown>) => def),
}));

vi.mock("./list.js", () => ({ default: { meta: { name: "list" } } }));
vi.mock("./add.js", () => ({ default: { meta: { name: "add" } } }));
vi.mock("./delete.js", () => ({ default: { meta: { name: "delete" } } }));

import replicasCommand from "./index.js";

describe("replicas command", () => {
  it("has correct meta", () => {
    const meta = replicasCommand.meta as { name: string; description: string };
    expect(meta.name).toBe("replicas");
    expect(meta.description).toBe("Manage read replicas");
  });

  it("lazy-loads all subcommands", async () => {
    const subCmds = replicasCommand.subCommands as Record<string, () => Promise<unknown>>;
    const results = await Promise.all(Object.values(subCmds).map((loader) => loader()));
    expect(results).toHaveLength(6);
  });
});
