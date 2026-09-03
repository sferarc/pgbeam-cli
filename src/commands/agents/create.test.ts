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
}));

vi.mock("./secrets.js", () => ({
  printAgentSecrets: vi.fn(),
}));

import { requireProject, resolveContext } from "../../lib/client.js";
import { output } from "../../lib/output.js";
import createCommand from "./create.js";

const run = createCommand.run;
if (!run) throw new Error("command.run is not defined");

const mockCreateAgentCredential = vi.fn();
const baseArgs = { client: "claude", json: false, "no-color": false, debug: false };

describe("agents create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveContext).mockReturnValue({
      client: { agents: { createAgentCredential: mockCreateAgentCredential } } as never,
      orgId: "org_123",
      projectId: "prj_1",
    });
    vi.mocked(requireProject).mockReturnValue("prj_1");
    mockCreateAgentCredential.mockResolvedValue({ credential: { id: "agt_1" } });
  });

  it("defaults to an agent principal (no principal_type sent)", async () => {
    await run({ args: { ...baseArgs, name: "Claude", policy: "pol_1" } } as never);

    expect(mockCreateAgentCredential).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_1" },
      body: { name: "Claude", policy_profile_id: "pol_1" },
    });
  });

  it("mints a human credential with --principal-type human", async () => {
    await run({
      args: { ...baseArgs, name: "Analyst", policy: "pol_1", "principal-type": "human" },
    } as never);

    expect(mockCreateAgentCredential).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_1" },
      body: { name: "Analyst", policy_profile_id: "pol_1", principal_type: "human" },
    });
  });

  it("rejects an invalid --principal-type", async () => {
    await expect(
      run({
        args: { ...baseArgs, name: "x", policy: "pol_1", "principal-type": "robot" },
      } as never),
    ).rejects.toThrow(/Invalid principal-type/);
    expect(mockCreateAgentCredential).not.toHaveBeenCalled();
  });

  it("outputs JSON when --json is set", async () => {
    const result = { credential: { id: "agt_1" } };
    mockCreateAgentCredential.mockResolvedValue(result);

    await run({
      args: { ...baseArgs, name: "ci", policy: "pol_1", json: true },
    } as never);

    expect(output).toHaveBeenCalledWith(result, true, expect.any(Function));
  });
});
