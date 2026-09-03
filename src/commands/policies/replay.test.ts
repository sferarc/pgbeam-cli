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
import replayCommand from "./replay.js";

const run = replayCommand.run;
if (!run) throw new Error("command.run is not defined");

const mockReplayPolicy = vi.fn();
const baseArgs = { json: false, "no-color": false, debug: false };

/** A replay result with no changes, in the shape the printer reads. */
function emptyResult(summary: Record<string, unknown> = {}) {
  return {
    summary: {
      entries_scanned: 0,
      distinct_queries: 0,
      evaluated: 0,
      would_allow: 0,
      would_block: 0,
      would_mask: 0,
      would_row_filter: 0,
      newly_blocked: 0,
      newly_allowed: 0,
      skipped_unparseable: 0,
      truncated: false,
      traffic_scope: "project",
      ...summary,
    },
    items: [],
  };
}

/** The lines the command printed through consola.log, joined. */
function printed() {
  return vi
    .mocked(consola.log)
    .mock.calls.map((c) => String(c[0]))
    .join("\n");
}

describe("policies replay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveContext).mockReturnValue({
      client: { policies: { replayPolicy: mockReplayPolicy } } as never,
      orgId: "org_123",
      projectId: "prj_linked",
    });
    vi.mocked(requireProject).mockReturnValue("prj_linked");
    mockReplayPolicy.mockResolvedValue(emptyResult());
  });

  it("sends bound_policy_id when --bound-policy is given", async () => {
    mockReplayPolicy.mockResolvedValue(
      emptyResult({ traffic_scope: "bound_credentials", bound_credentials: 2 }),
    );

    await run({
      args: { ...baseArgs, draft: "./policy.json", "bound-policy": "pol_1" },
    } as never);

    expect(mockReplayPolicy).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_linked" },
      body: {
        policy: { name: "draft", access_mode: "read_only" },
        bound_policy_id: "pol_1",
      },
    });
  });

  it("omits bound_policy_id when the flag is absent", async () => {
    await run({ args: { ...baseArgs, policy: "pol_1" } } as never);

    expect(mockReplayPolicy).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_linked" },
      body: { policy_id: "pol_1" },
    });
  });

  it("exits when --credential and --bound-policy are combined", async () => {
    const exitError = new Error("process.exit");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw exitError;
    });

    await expect(
      run({
        args: {
          ...baseArgs,
          policy: "pol_1",
          credential: "cred_1",
          "bound-policy": "pol_1",
        },
      } as never),
    ).rejects.toThrow("process.exit");
    expect(consola.error).toHaveBeenCalled();
    expect(mockReplayPolicy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it("names the project-wide scope so an unnarrowed replay is not read as targeted", async () => {
    await run({ args: { ...baseArgs, policy: "pol_1" } } as never);

    expect(printed()).toContain("every credential in the project");
  });

  it("reports how many credentials a bound replay covered", async () => {
    mockReplayPolicy.mockResolvedValue(
      emptyResult({ traffic_scope: "bound_credentials", bound_credentials: 2 }),
    );

    await run({
      args: { ...baseArgs, policy: "pol_1", "bound-policy": "pol_1" },
    } as never);

    expect(printed()).toContain("traffic from the 2 credentials bound to pol_1");
  });

  // A policy that binds nobody replays nothing. Without this line the run
  // prints "0 newly blocked" and reads as a green light for the change.
  it("says a bound replay covering no credentials is not evidence of safety", async () => {
    mockReplayPolicy.mockResolvedValue(
      emptyResult({ traffic_scope: "bound_credentials", bound_credentials: 0 }),
    );

    await run({
      args: { ...baseArgs, policy: "pol_1", "bound-policy": "pol_1" },
    } as never);

    expect(printed()).toContain("No agent credential is bound to that policy");
    expect(printed()).toContain("not evidence the change is safe");
  });
});
