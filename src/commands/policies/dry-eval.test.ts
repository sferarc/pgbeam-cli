import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => JSON.stringify({ name: "draft", access_mode: "read_only" })),
}));

vi.mock("consola", () => ({
  consola: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    log: vi.fn(),
  },
}));

vi.mock("../../lib/client.js", () => ({
  resolveContext: vi.fn(),
  requireProject: vi.fn(),
}));

vi.mock("../../lib/errors.js", () => ({
  runCommand: vi.fn(async (fn) => fn()),
}));

vi.mock("../../lib/output.js", () => ({
  output: vi.fn((data, json, tableFn) => {
    void data;
    if (json) return;
    if (tableFn) tableFn();
  }),
}));

import { consola } from "consola";
import { requireProject, resolveContext } from "../../lib/client.js";
import { output } from "../../lib/output.js";
import dryEvalCommand from "./dry-eval.js";

const run = dryEvalCommand.run;
if (!run) throw new Error("command.run is not defined");

const mockDryEvalPolicy = vi.fn();
const baseArgs = { json: false, "no-color": false, debug: false };

describe("policies dry-eval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveContext).mockReturnValue({
      client: { policies: { dryEvalPolicy: mockDryEvalPolicy } } as never,
      orgId: "org_123",
      projectId: "prj_linked",
    });
    vi.mocked(requireProject).mockReturnValue("prj_linked");
    mockDryEvalPolicy.mockResolvedValue({ verdict: "allow", rule: "ok", reason: "permitted" });
  });

  it("evaluates against a saved policy by id", async () => {
    await run({
      args: { ...baseArgs, sql: "SELECT 1", policy: "pol_1" },
    } as never);

    expect(mockDryEvalPolicy).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_linked" },
      body: { sql: "SELECT 1", policy_id: "pol_1" },
    });
  });

  it("evaluates against a draft policy from a file", async () => {
    await run({
      args: { ...baseArgs, sql: "DELETE FROM users", draft: "./policy.json" },
    } as never);

    expect(mockDryEvalPolicy).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_linked" },
      body: { sql: "DELETE FROM users", policy: { name: "draft", access_mode: "read_only" } },
    });
  });

  it("exits when neither --policy nor --draft is given", async () => {
    const exitError = new Error("process.exit");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw exitError;
    });

    await expect(run({ args: { ...baseArgs, sql: "SELECT 1" } } as never)).rejects.toThrow(
      "process.exit",
    );
    expect(consola.error).toHaveBeenCalled();
    expect(mockDryEvalPolicy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it("exits when both --policy and --draft are given", async () => {
    const exitError = new Error("process.exit");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw exitError;
    });

    await expect(
      run({
        args: { ...baseArgs, sql: "SELECT 1", policy: "pol_1", draft: "./policy.json" },
      } as never),
    ).rejects.toThrow("process.exit");
    expect(mockDryEvalPolicy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it("outputs JSON when --json is set", async () => {
    const result = { verdict: "block", rule: "read_only", reason: "writes blocked" };
    mockDryEvalPolicy.mockResolvedValue(result);

    await run({
      args: { ...baseArgs, sql: "DELETE FROM t", policy: "pol_1", json: true },
    } as never);

    expect(output).toHaveBeenCalledWith(result, true, expect.any(Function));
  });

  it("reports a missing --draft file before resolving auth", async () => {
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory, open './missing.json'");
    });

    await expect(
      run({ args: { ...baseArgs, sql: "SELECT 1", draft: "./missing.json" } } as never),
    ).rejects.toThrow(/Could not read --draft \.\/missing\.json/);
    expect(resolveContext).not.toHaveBeenCalled();
    expect(mockDryEvalPolicy).not.toHaveBeenCalled();
  });

  it("reports a schema-invalid --draft body before resolving auth", async () => {
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ acces_mode: "read_only" }));

    await expect(
      run({ args: { ...baseArgs, sql: "SELECT 1", draft: "./typo.json" } } as never),
    ).rejects.toThrow(/unknown field/);
    expect(resolveContext).not.toHaveBeenCalled();
    expect(mockDryEvalPolicy).not.toHaveBeenCalled();
  });
});
