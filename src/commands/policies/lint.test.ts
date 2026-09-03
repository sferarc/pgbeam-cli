import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => JSON.stringify({ name: "draft", access_mode: "read_write" })),
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
import lintCommand from "./lint.js";

const run = lintCommand.run;
if (!run) throw new Error("command.run is not defined");

const mockGetPolicyProfile = vi.fn();
const baseArgs = { json: false, "no-color": false, debug: false, strict: false };

describe("policies lint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveContext).mockReturnValue({
      client: { policies: { getPolicyProfile: mockGetPolicyProfile } } as never,
      orgId: "org_123",
      projectId: "prj_linked",
    });
    vi.mocked(requireProject).mockReturnValue("prj_linked");
    // A tightly scoped read-only policy: no findings.
    mockGetPolicyProfile.mockResolvedValue({
      access_mode: "read_only",
      table_allowlist: ["users"],
      max_rows: 100,
      budget_queries_per_hour: 200,
    });
  });

  it("lints a saved policy by id", async () => {
    await run({ args: { ...baseArgs, policy: "pol_1" } } as never);

    expect(mockGetPolicyProfile).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_linked", policy_id: "pol_1" },
    });
    expect(consola.success).toHaveBeenCalledWith("No policy risks found.");
  });

  it("prints findings for a risky saved policy", async () => {
    mockGetPolicyProfile.mockResolvedValue({ access_mode: "read_write" });
    await run({ args: { ...baseArgs, policy: "pol_1" } } as never);
    // At least one finding line was logged.
    expect(consola.log).toHaveBeenCalled();
    expect(consola.success).not.toHaveBeenCalled();
  });

  it("lints a draft policy from a file without calling the API", async () => {
    await run({ args: { ...baseArgs, draft: "./policy.json" } } as never);
    expect(mockGetPolicyProfile).not.toHaveBeenCalled();
    expect(resolveContext).not.toHaveBeenCalled();
    // The mocked draft is read_write with no allowlist, so findings exist.
    expect(consola.success).not.toHaveBeenCalled();
  });

  it("exits when neither --policy nor --draft is given", async () => {
    const exitError = new Error("process.exit");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw exitError;
    });

    await expect(run({ args: { ...baseArgs } } as never)).rejects.toThrow("process.exit");
    expect(consola.error).toHaveBeenCalled();
    expect(mockGetPolicyProfile).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it("exits when both --policy and --draft are given", async () => {
    const exitError = new Error("process.exit");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw exitError;
    });

    await expect(
      run({ args: { ...baseArgs, policy: "pol_1", draft: "./policy.json" } } as never),
    ).rejects.toThrow("process.exit");
    expect(mockGetPolicyProfile).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it("exits non-zero under --strict when a warning is present", async () => {
    mockGetPolicyProfile.mockResolvedValue({ access_mode: "read_write" });
    const exitError = new Error("process.exit");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw exitError;
    });

    await expect(
      run({ args: { ...baseArgs, policy: "pol_1", strict: true } } as never),
    ).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("does not exit under --strict when the policy is clean", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    await run({ args: { ...baseArgs, policy: "pol_1", strict: true } } as never);
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it("outputs JSON when --json is set", async () => {
    await run({ args: { ...baseArgs, policy: "pol_1", json: true } } as never);
    expect(output).toHaveBeenCalledWith(
      expect.objectContaining({ findings: expect.any(Array), summary: expect.any(Object) }),
      true,
      expect.any(Function),
    );
  });

  it("reports a missing --draft file before resolving auth", async () => {
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory, open './missing.json'");
    });

    await expect(run({ args: { ...baseArgs, draft: "./missing.json" } } as never)).rejects.toThrow(
      /Could not read --draft \.\/missing\.json/,
    );
    expect(resolveContext).not.toHaveBeenCalled();
  });
});
