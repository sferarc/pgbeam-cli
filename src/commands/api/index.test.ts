import { describe, expect, it, vi } from "vitest";

vi.mock("citty", () => ({
  defineCommand: vi.fn((def: Record<string, unknown>) => def),
}));

vi.mock("./ls.js", () => ({ default: { meta: { name: "ls" } } }));
vi.mock("./request.js", () => ({ default: { meta: { name: "request" } } }));
vi.mock("./schema.js", () => ({ default: { meta: { name: "schema" } } }));

import apiCommand from "./index.js";

describe("api command", () => {
  it("has correct meta", () => {
    const meta = apiCommand.meta as { name: string; description: string };
    expect(meta.name).toBe("api");
    expect(meta.description).toBe("Interact with the PgBeam API directly");
  });

  it("lazy-loads all subcommands", async () => {
    const subCmds = apiCommand.subCommands as Record<string, () => Promise<unknown>>;
    const results = await Promise.all(Object.values(subCmds).map((loader) => loader()));
    expect(results).toHaveLength(4);
  });
});
