import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
  input: vi.fn(),
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

import { confirm } from "@inquirer/prompts";
import { consola } from "consola";
import { requireProject, resolveContext } from "../../lib/client.js";
import disableCommand from "./disable.js";

const run = disableCommand.run;
if (!run) throw new Error("command.run is not defined");

const mockUpdateStatus = vi.fn();
const baseArgs = { id: "agt_1", json: false, "no-color": false, debug: false };

const originalIsTTY = process.stdin.isTTY;
function setTTY(value: boolean) {
  Object.defineProperty(process.stdin, "isTTY", { value, configurable: true });
}

class ExitError extends Error {
  constructor(readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

describe("agents disable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveContext).mockReturnValue({
      client: { agents: { updateAgentCredentialStatus: mockUpdateStatus } } as never,
      orgId: "org_1",
      projectId: "prj_1",
    });
    vi.mocked(requireProject).mockReturnValue("prj_1");
    mockUpdateStatus.mockResolvedValue(undefined);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new ExitError(code as number | undefined);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setTTY(originalIsTTY);
  });

  it("disables with --yes without prompting", async () => {
    setTTY(false);

    await run({ args: { ...baseArgs, yes: true } } as never);

    expect(confirm).not.toHaveBeenCalled();
    expect(mockUpdateStatus).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_1", agent_id: "agt_1" },
      body: { status: "disabled" },
    });
    expect(consola.success).toHaveBeenCalledWith("Agent credential agt_1 disabled");
  });

  it("refuses without --yes when stdin is not a TTY and makes no API call", async () => {
    setTTY(false);

    await expect(run({ args: { ...baseArgs, yes: false } } as never)).rejects.toEqual(
      new ExitError(1),
    );

    expect(consola.error).toHaveBeenCalledWith(
      "Disable requires confirmation. Re-run with --yes to confirm in a non-interactive environment.",
    );
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });

  it("cancels cleanly when the prompt is declined and makes no API call", async () => {
    setTTY(true);
    vi.mocked(confirm).mockResolvedValue(false);

    await run({ args: { ...baseArgs, yes: false } } as never);

    expect(process.exit).not.toHaveBeenCalled();
    expect(consola.info).toHaveBeenCalledWith("Cancelled.");
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });
});
