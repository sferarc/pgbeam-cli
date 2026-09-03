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

const mockUpdateProject = vi.fn();
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
import updateCommand from "./update.js";

const run = updateCommand.run;
if (!run) throw new Error("command.run is not defined");

describe("projects update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveContext).mockReturnValue({
      client: {
        projects: { updateProject: mockUpdateProject },
      } as never,
      orgId: "org_123",
      projectId: "prj_linked",
    });
    vi.mocked(requireProject).mockReturnValue("prj_linked");
  });

  it("updates project name by positional ID", async () => {
    mockUpdateProject.mockResolvedValue({ id: "prj_1", name: "new-name" });

    await run({
      args: { id: "prj_1", name: "new-name", json: false, "no-color": false, debug: false },
    } as never);

    expect(mockUpdateProject).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_1" },
      body: { name: "new-name" },
    });
    expect(consola.success).toHaveBeenCalledWith("Project prj_1 updated.");
  });

  it("uses linked project when no positional ID", async () => {
    mockUpdateProject.mockResolvedValue({ id: "prj_linked", name: "updated" });

    await run({
      args: { id: undefined, name: "updated", json: false, "no-color": false, debug: false },
    } as never);

    expect(requireProject).toHaveBeenCalled();
    expect(mockUpdateProject).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_linked" },
      body: { name: "updated" },
    });
  });

  it("exits with error when no --name provided", async () => {
    const exitError = new Error("process.exit");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw exitError;
    });

    await expect(
      run({
        args: { id: "prj_1", json: false, "no-color": false, debug: false },
      } as never),
    ).rejects.toThrow("process.exit");

    expect(consola.error).toHaveBeenCalledWith(
      "Nothing to update. Pass --name, --description, --tags, --status, --allowed-cidrs, --default-policy-profile-id, or --agents-disabled.",
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockUpdateProject).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it("outputs JSON when --json flag is set", async () => {
    const result = { id: "prj_1", name: "updated" };
    mockUpdateProject.mockResolvedValue(result);

    await run({
      args: { id: "prj_1", name: "updated", json: true, "no-color": false, debug: false },
    } as never);

    expect(output).toHaveBeenCalledWith(result, true, expect.any(Function));
  });

  it("engages the kill-switch with --agents-disabled true", async () => {
    mockUpdateProject.mockResolvedValue({ id: "prj_1", agents_disabled: true });

    await run({
      args: {
        id: "prj_1",
        "agents-disabled": "true",
        json: false,
        "no-color": false,
        debug: false,
      },
    } as never);

    expect(mockUpdateProject).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_1" },
      body: { agents_disabled: true },
    });
    expect(consola.warn).toHaveBeenCalledWith(
      "Kill-switch engaged: all agent-credential connections are now blocked.",
    );
  });

  it("releases the kill-switch with --agents-disabled false", async () => {
    mockUpdateProject.mockResolvedValue({ id: "prj_1", agents_disabled: false });

    await run({
      args: {
        id: "prj_1",
        "agents-disabled": "false",
        json: false,
        "no-color": false,
        debug: false,
      },
    } as never);

    expect(mockUpdateProject).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_1" },
      body: { agents_disabled: false },
    });
    expect(consola.info).toHaveBeenCalledWith(
      "Kill-switch released: agent-credential connections are re-enabled.",
    );
  });

  it("rejects a non-boolean --agents-disabled value", async () => {
    const exitError = new Error("process.exit");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw exitError;
    });

    await expect(
      run({
        args: {
          id: "prj_1",
          "agents-disabled": "maybe",
          json: false,
          "no-color": false,
          debug: false,
        },
      } as never),
    ).rejects.toThrow("process.exit");

    expect(mockUpdateProject).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it("parses CIDR ranges into the IP allowlist", async () => {
    mockUpdateProject.mockResolvedValue({ id: "prj_1" });

    await run({
      args: {
        id: "prj_1",
        "allowed-cidrs": "203.0.113.0/24, 10.0.0.0/8",
        json: false,
        "no-color": false,
        debug: false,
      },
    } as never);

    expect(mockUpdateProject).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_1" },
      body: { allowed_cidrs: [{ cidr: "203.0.113.0/24" }, { cidr: "10.0.0.0/8" }] },
    });
  });

  it("clears the IP allowlist with an empty --allowed-cidrs", async () => {
    mockUpdateProject.mockResolvedValue({ id: "prj_1" });

    await run({
      args: {
        id: "prj_1",
        "allowed-cidrs": "",
        json: false,
        "no-color": false,
        debug: false,
      },
    } as never);

    expect(mockUpdateProject).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_1" },
      body: { allowed_cidrs: [] },
    });
  });

  it("updates description, tags, and default policy", async () => {
    mockUpdateProject.mockResolvedValue({ id: "prj_1" });

    await run({
      args: {
        id: "prj_1",
        description: "Prod proxy",
        tags: "prod, us-east-1",
        "default-policy-profile-id": "pol_9",
        json: false,
        "no-color": false,
        debug: false,
      },
    } as never);

    expect(mockUpdateProject).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_1" },
      body: {
        description: "Prod proxy",
        tags: ["prod", "us-east-1"],
        default_policy_profile_id: "pol_9",
      },
    });
  });
});
