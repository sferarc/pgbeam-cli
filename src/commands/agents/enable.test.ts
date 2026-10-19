import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { consola } from "consola";
import { requireProject, resolveContext } from "../../lib/client.js";
import enableCommand from "./enable.js";

const run = enableCommand.run;
if (!run) throw new Error("command.run is not defined");

const mockUpdateStatus = vi.fn();
const baseArgs = { id: "agt_1", json: false, "no-color": false, debug: false };

class ExitError extends Error {
  constructor(readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

describe("agents enable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveContext).mockReturnValue({
      client: { agents: { updateAgentCredentialStatus: mockUpdateStatus } } as never,
      orgId: "org_1",
      projectId: "prj_1",
    });
    vi.mocked(requireProject).mockReturnValue("prj_1");
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new ExitError(code as number | undefined);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sets the credential status to active", async () => {
    mockUpdateStatus.mockResolvedValue(undefined);

    await run({ args: baseArgs } as never);

    expect(mockUpdateStatus).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_1", agent_id: "agt_1" },
      body: { status: "active" },
    });
    expect(consola.success).toHaveBeenCalledWith("Agent credential agt_1 enabled");
  });

  it("exits non-zero without a success message when the API refuses", async () => {
    mockUpdateStatus.mockRejectedValue(new Error("credential is revoked"));

    await expect(run({ args: baseArgs } as never)).rejects.toEqual(new ExitError(1));

    expect(consola.error).toHaveBeenCalledWith("credential is revoked");
    expect(consola.success).not.toHaveBeenCalled();
  });
});
