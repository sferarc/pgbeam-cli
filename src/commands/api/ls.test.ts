import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("citty", () => ({
  defineCommand: (config: Record<string, unknown>) => config,
}));

vi.mock("../../lib/flags.js", () => ({
  globalArgs: {},
}));

vi.mock("pgbeam/operations", () => ({
  operationsByTag: {
    projects: {
      listProjects: { method: "GET", path: "/v1/projects" },
      getProject: { method: "GET", path: "/v1/projects/{project_id}" },
    },
    databases: {
      listDatabases: { method: "GET", path: "/v1/projects/{project_id}/databases" },
    },
  },
}));

vi.mock("../../lib/output.js", () => ({
  output: vi.fn(),
}));

vi.mock("consola", () => ({
  consola: { log: vi.fn() },
}));

import { consola } from "consola";
import { output } from "../../lib/output.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function runHandler(args: Record<string, unknown>) {
  const mod = await import("./ls.js");
  const command = mod.default;
  await command.run?.({ args: { json: false, "no-color": false, debug: false, ...args } } as never);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
});

describe("api ls", () => {
  it("outputs JSON array when --json is set", async () => {
    await runHandler({ json: true });

    expect(output).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          method: "GET",
          path: "/v1/projects",
          tag: "projects",
          operation: "listProjects",
        }),
      ]),
      true,
    );
  });

  it("logs grouped endpoints in table format when not --json", async () => {
    await runHandler({});

    // Should log the tag names and endpoints
    expect(consola.log).toHaveBeenCalled();
    const calls = vi.mocked(consola.log).mock.calls.map((c) => c[0]);
    expect(calls).toContainEqual(expect.stringContaining("projects"));
  });

  it("includes all operations from all tags", async () => {
    await runHandler({ json: true });

    const endpoints = vi.mocked(output).mock.calls[0][0] as Array<Record<string, string>>;
    expect(endpoints).toHaveLength(3);
    expect(endpoints.map((e) => e.operation)).toEqual([
      "listProjects",
      "getProject",
      "listDatabases",
    ]);
  });
});
