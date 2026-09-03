import { describe, expect, it, vi } from "vitest";

vi.mock("citty", () => ({
  defineCommand: vi.fn((def: Record<string, unknown>) => def),
}));

// list, inspect, and delete are generated from the OpenAPI contract (composed
// via generatedLeaf); the rest stay bespoke, hand-authored modules.
vi.mock("./create.js", () => ({ default: { meta: { name: "create" } } }));
vi.mock("./update.js", () => ({ default: { meta: { name: "update" } } }));
vi.mock("./usage.js", () => ({ default: { meta: { name: "usage" } } }));
vi.mock("../link.js", () => ({ default: { meta: { name: "link" } } }));
vi.mock("../unlink.js", () => ({ default: { meta: { name: "unlink" } } }));
vi.mock("../domains/index.js", () => ({ default: { meta: { name: "domains" } } }));
vi.mock("../replicas/index.js", () => ({ default: { meta: { name: "replicas" } } }));
vi.mock("../cache-rules/index.js", () => ({ default: { meta: { name: "cache-rules" } } }));
vi.mock("../env/index.js", () => ({ default: { meta: { name: "env" } } }));

import projectsCommand from "./index.js";

describe("projects command", () => {
  it("has correct meta", () => {
    const meta = projectsCommand.meta as { name: string; description: string };
    expect(meta.name).toBe("projects");
    expect(meta.description).toBe("Manage projects");
  });

  it("lazy-loads all subcommands", async () => {
    const subCmds = projectsCommand.subCommands as Record<string, () => Promise<unknown>>;
    const results = await Promise.all(Object.values(subCmds).map((loader) => loader()));
    expect(results).toHaveLength(14);
    for (const result of results) {
      expect(result).toHaveProperty("meta");
    }
  });
});
