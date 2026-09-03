import { beforeEach, describe, expect, it, vi } from "vitest";

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
  outputJson: vi.fn(),
}));

import { consola } from "consola";
import { requireProject, resolveContext } from "../../lib/client.js";
import { output, outputJson } from "../../lib/output.js";
import updateCommand from "./update.js";

const run = updateCommand.run;
if (!run) throw new Error("command.run is not defined");

const mockGetPolicyProfile = vi.fn();
const mockUpdatePolicyProfile = vi.fn();

const currentProfile = {
  id: "pol_1",
  name: "read-only",
  access_mode: "read_only",
  table_allowlist: [],
  table_denylist: [],
  masking_rules: [],
  max_rows: 0,
  max_affected_rows: 100,
  budget_queries_per_day: 0,
};

const baseArgs = { json: false, "no-color": false, debug: false };

describe("policies update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveContext).mockReturnValue({
      client: {
        policies: {
          getPolicyProfile: mockGetPolicyProfile,
          updatePolicyProfile: mockUpdatePolicyProfile,
        },
      } as never,
      orgId: "org_123",
      projectId: "prj_linked",
    });
    vi.mocked(requireProject).mockReturnValue("prj_linked");
    mockGetPolicyProfile.mockResolvedValue(currentProfile);
    mockUpdatePolicyProfile.mockResolvedValue({ ...currentProfile, access_mode: "read_write" });
  });

  it("reads the current profile then updates only the changed field", async () => {
    await run({ args: { ...baseArgs, id: "pol_1", mode: "read_write" } } as never);

    expect(mockGetPolicyProfile).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_linked", policy_id: "pol_1" },
    });
    expect(mockUpdatePolicyProfile).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_linked", policy_id: "pol_1" },
      body: expect.objectContaining({ name: "read-only", access_mode: "read_write" }),
    });
    expect(consola.success).toHaveBeenCalledWith("Policy profile pol_1 updated.");
  });

  it("parses a comma-separated table allowlist", async () => {
    await run({
      args: { ...baseArgs, id: "pol_1", "table-allowlist": "public.users, public.orders" },
    } as never);

    expect(mockUpdatePolicyProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ table_allowlist: ["public.users", "public.orders"] }),
      }),
    );
  });

  it("parses numeric budget flags", async () => {
    await run({
      args: { ...baseArgs, id: "pol_1", "budget-queries-per-day": "5000", "max-rows": "1000" },
    } as never);

    expect(mockUpdatePolicyProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ budget_queries_per_day: 5000, max_rows: 1000 }),
      }),
    );
  });

  it("preserves the existing max_affected_rows cap on a single-flag edit", async () => {
    await run({ args: { ...baseArgs, id: "pol_1", mode: "read_write" } } as never);

    expect(mockUpdatePolicyProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ max_affected_rows: 100 }),
      }),
    );
  });

  it("updates max_affected_rows when the flag is passed", async () => {
    await run({
      args: { ...baseArgs, id: "pol_1", "max-affected-rows": "500" },
    } as never);

    expect(mockUpdatePolicyProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ max_affected_rows: 500 }),
      }),
    );
  });

  it("exits when no field flag is provided", async () => {
    const exitError = new Error("process.exit");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw exitError;
    });

    await expect(run({ args: { ...baseArgs, id: "pol_1" } } as never)).rejects.toThrow(
      "process.exit",
    );

    expect(consola.error).toHaveBeenCalled();
    expect(mockUpdatePolicyProfile).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it("replaces the allowlist and denylist from repeatable --allow/--deny flags", async () => {
    await run({
      args: { ...baseArgs, id: "pol_1" },
      rawArgs: [
        "pol_1",
        "--allow",
        "public.users",
        "--allow",
        "public.orders",
        "--deny",
        "public.secrets",
      ],
    } as never);

    expect(mockUpdatePolicyProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          table_allowlist: ["public.users", "public.orders"],
          table_denylist: ["public.secrets"],
        }),
      }),
    );
  });

  it("replaces masking rules from repeatable --mask flags", async () => {
    await run({
      args: { ...baseArgs, id: "pol_1", mask: "users.email=redact" },
    } as never);

    expect(mockUpdatePolicyProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          masking_rules: [{ table: "users", column: "email", kind: "redact" }],
        }),
      }),
    );
  });

  it("rejects an invalid --mask kind with a clear message", async () => {
    await expect(
      run({ args: { ...baseArgs, id: "pol_1", mask: "users.email=scramble" } } as never),
    ).rejects.toThrow(/Invalid --mask kind "scramble".*redact, null, hash/);
    expect(mockUpdatePolicyProfile).not.toHaveBeenCalled();
  });

  it("--dry-run prints the resolved body without applying the update", async () => {
    await run({
      args: { ...baseArgs, id: "pol_1", mode: "read_write", "dry-run": true },
    } as never);

    expect(mockGetPolicyProfile).toHaveBeenCalled();
    expect(outputJson).toHaveBeenCalledWith(
      expect.objectContaining({ name: "read-only", access_mode: "read_write" }),
    );
    expect(consola.info).toHaveBeenCalledWith(expect.stringContaining("policies dry-eval"));
    expect(mockUpdatePolicyProfile).not.toHaveBeenCalled();
  });

  it("rejects an invalid mode", async () => {
    await expect(
      run({ args: { ...baseArgs, id: "pol_1", mode: "bogus" } } as never),
    ).rejects.toThrow(/Invalid mode/);
    expect(mockUpdatePolicyProfile).not.toHaveBeenCalled();
  });

  it("outputs JSON when --json is set", async () => {
    const result = { ...currentProfile, access_mode: "read_write" };
    mockUpdatePolicyProfile.mockResolvedValue(result);

    await run({ args: { ...baseArgs, id: "pol_1", mode: "read_write", json: true } } as never);

    expect(output).toHaveBeenCalledWith(result, true, expect.any(Function));
  });
});
