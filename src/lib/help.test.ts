import { describe, expect, it, vi } from "vitest";

vi.mock("citty", () => ({
  renderUsage: vi.fn(async () => "USAGE pgbeam things list"),
}));

import type { CommandDef } from "citty";
import { renderUsageWithExamples } from "./help";

describe("renderUsageWithExamples", () => {
  it("returns the plain usage when the command has no examples", async () => {
    const cmd = { meta: { name: "list", description: "List things" } } as CommandDef;
    expect(await renderUsageWithExamples(cmd)).toBe("USAGE pgbeam things list");
  });

  it("appends an EXAMPLES section from meta.docs.examples", async () => {
    const cmd = {
      meta: {
        name: "list",
        description: "List things",
        docs: {
          longDescription: "List all the things.",
          examples: [
            { comment: "List things", command: "pgbeam things list" },
            { comment: "As JSON", command: "pgbeam things list --json" },
          ],
          response: "A table.",
        },
      },
    } as CommandDef;

    const usage = await renderUsageWithExamples(cmd);
    expect(usage).toContain("USAGE pgbeam things list");
    expect(usage).toContain("EXAMPLES");
    expect(usage).toContain("# List things");
    expect(usage).toContain("pgbeam things list --json");
  });

  it("resolves a lazy meta function", async () => {
    const cmd = {
      meta: () => ({
        name: "x",
        docs: {
          longDescription: "",
          examples: [{ comment: "c", command: "pgbeam x" }],
          response: "",
        },
      }),
    } as unknown as CommandDef;

    const usage = await renderUsageWithExamples(cmd);
    expect(usage).toContain("# c");
  });
});
