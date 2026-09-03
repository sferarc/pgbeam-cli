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

import { consola } from "consola";
import { requireProject, resolveContext } from "../../lib/client.js";
import { output } from "../../lib/output.js";
import inspectCommand from "./inspect.js";

const run = inspectCommand.run;
if (!run) throw new Error("command.run is not defined");

const mockGetAgentCredential = vi.fn();
const mockGetPolicyProfile = vi.fn();
const baseArgs = { json: false, "no-color": false, debug: false };

function loggedText(): string {
  return vi
    .mocked(consola.log)
    .mock.calls.map((call) => String(call[0]))
    .join("\n");
}

describe("agents inspect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveContext).mockReturnValue({
      client: {
        agents: { getAgentCredential: mockGetAgentCredential },
        policies: { getPolicyProfile: mockGetPolicyProfile },
      } as never,
      orgId: "org_123",
      projectId: "prj_linked",
    });
    vi.mocked(requireProject).mockReturnValue("prj_linked");
    mockGetAgentCredential.mockResolvedValue({
      id: "agt_1",
      name: "analytics reader",
      pg_username: "agent_a1b2c3",
      policy_profile_id: "pol_1",
      status: "active",
      expires_at: null,
    });
    mockGetPolicyProfile.mockResolvedValue({
      id: "pol_1",
      name: "Read-only analytics",
      access_mode: "read_only",
      table_allowlist: ["users"],
      max_rows: 100,
      budget_queries_per_hour: 200,
    });
  });

  it("fetches the credential and the policy attached to it", async () => {
    await run({ args: { ...baseArgs, id: "agt_1" } } as never);

    expect(mockGetAgentCredential).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_linked", agent_id: "agt_1" },
    });
    expect(mockGetPolicyProfile).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_linked", policy_id: "pol_1" },
    });
  });

  it("prints the capability card", async () => {
    await run({ args: { ...baseArgs, id: "agt_1" } } as never);
    const text = loggedText();
    expect(text).toContain('Credential agt_1 "analytics reader"');
    expect(text).toContain("Statements (access_mode read_only)");
    expect(text).toContain("Policy warnings: none.");
  });

  it("returns the card object under --json", async () => {
    await run({ args: { ...baseArgs, id: "agt_1", json: true } } as never);
    expect(output).toHaveBeenCalledWith(
      expect.objectContaining({
        credential: expect.objectContaining({ id: "agt_1", usable: true }),
        access: expect.objectContaining({ mode: "read_only" }),
        findings: expect.any(Array),
      }),
      true,
      expect.any(Function),
    );
    expect(consola.log).not.toHaveBeenCalled();
  });

  it("fails clearly when the credential has no policy attached", async () => {
    mockGetAgentCredential.mockResolvedValue({ id: "agt_1", status: "active" });
    await expect(run({ args: { ...baseArgs, id: "agt_1" } } as never)).rejects.toThrow(
      /no policy profile attached/,
    );
    expect(mockGetPolicyProfile).not.toHaveBeenCalled();
  });
});
