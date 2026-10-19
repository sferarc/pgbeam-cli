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

vi.mock("./secrets.js", () => ({
  printAgentSecrets: vi.fn(),
}));

import { confirm } from "@inquirer/prompts";
import { consola } from "consola";
import { requireProject, resolveContext } from "../../lib/client.js";
import rotateCommand from "./rotate.js";
import { printAgentSecrets } from "./secrets.js";

const run = rotateCommand.run;
if (!run) throw new Error("command.run is not defined");

const mockRotate = vi.fn();
const rotated = {
  credential: { id: "agt_1" },
  connection_string: "postgresql://agt_1:secret@proxy.example:5432/app",
  mcp_url: "https://mcp.example/mcp",
  mcp_token: "mcp_secret",
};
const baseArgs = { id: "agt_1", client: "claude", json: false, "no-color": false, debug: false };

const originalIsTTY = process.stdin.isTTY;
function setTTY(value: boolean) {
  Object.defineProperty(process.stdin, "isTTY", { value, configurable: true });
}

class ExitError extends Error {
  constructor(readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

describe("agents rotate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveContext).mockReturnValue({
      client: { agents: { rotateAgentCredential: mockRotate } } as never,
      orgId: "org_1",
      projectId: "prj_1",
    });
    vi.mocked(requireProject).mockReturnValue("prj_1");
    mockRotate.mockResolvedValue(rotated);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new ExitError(code as number | undefined);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setTTY(originalIsTTY);
  });

  it("rotates with --yes and prints the new secrets", async () => {
    setTTY(false);

    await run({ args: { ...baseArgs, yes: true } } as never);

    expect(confirm).not.toHaveBeenCalled();
    expect(mockRotate).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_1", agent_id: "agt_1" },
    });
    expect(consola.success).toHaveBeenCalledWith("Agent credential agt_1 rotated");
    expect(printAgentSecrets).toHaveBeenCalledWith(rotated, "claude");
  });

  it("rotates with --yes --json and writes the secrets object to stdout", async () => {
    setTTY(false);
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await run({ args: { ...baseArgs, yes: true, json: true } } as never);

    expect(mockRotate).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(`${JSON.stringify(rotated, null, 2)}\n`);
    expect(printAgentSecrets).not.toHaveBeenCalled();
  });

  it("refuses without --yes when stdin is not a TTY and makes no API call", async () => {
    setTTY(false);

    await expect(run({ args: { ...baseArgs, yes: false } } as never)).rejects.toEqual(
      new ExitError(1),
    );

    expect(consola.error).toHaveBeenCalledWith(
      "Rotate requires confirmation. Re-run with --yes to confirm in a non-interactive environment.",
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(mockRotate).not.toHaveBeenCalled();
  });

  it("prompts on a TTY and rotates once confirmed", async () => {
    setTTY(true);
    vi.mocked(confirm).mockResolvedValue(true);

    await run({ args: { ...baseArgs, yes: false } } as never);

    expect(confirm).toHaveBeenCalledWith({
      message:
        "Rotate agent credential agt_1? Its current password and MCP token stop working within seconds and cannot be restored.",
      default: false,
    });
    expect(mockRotate).toHaveBeenCalledTimes(1);
  });

  it("cancels cleanly when the prompt is declined and makes no API call", async () => {
    setTTY(true);
    vi.mocked(confirm).mockResolvedValue(false);

    await run({ args: { ...baseArgs, yes: false } } as never);

    expect(process.exit).not.toHaveBeenCalled();
    expect(consola.info).toHaveBeenCalledWith("Cancelled.");
    expect(mockRotate).not.toHaveBeenCalled();
    expect(printAgentSecrets).not.toHaveBeenCalled();
  });
});
