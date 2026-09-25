import type { CommandDef } from "citty";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { commandManifest } from "../../generated/manifest.gen.js";

const request = vi.fn();
const confirmDestructive = vi.fn();
const output = vi.fn((_data: unknown, json: boolean, tableFn?: () => void) => {
  if (!json && tableFn) tableFn();
});
const outputTable = vi.fn();

vi.mock("../../lib/client.js", () => ({
  resolveContext: () => ({ client: { request }, orgId: "org_test", projectId: "prj_test" }),
  requireProject: (ctx: { projectId: string | null }) => {
    if (!ctx.projectId) throw new Error("no project");
    return ctx.projectId;
  },
  requireOrg: (ctx: { orgId: string | null }) => {
    if (!ctx.orgId) throw new Error("no org");
    return ctx.orgId;
  },
}));

vi.mock("../../lib/confirm.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/confirm.js")>();
  return {
    ...actual,
    confirmDestructive: (...args: unknown[]) => confirmDestructive(...args),
  };
});

vi.mock("../../lib/output.js", () => ({
  output: (...args: [unknown, boolean, (() => void)?]) => output(...args),
  outputTable: (...args: unknown[]) => outputTable(...args),
}));

vi.mock("consola", () => ({
  consola: { log: vi.fn(), info: vi.fn(), success: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { buildGeneratedCommand } from "../../lib/generated-command.js";
import rulesCommand from "./rules.js";

function spec(operationId: string) {
  const found = commandManifest.find((c) => c.operationId === operationId);
  if (!found) throw new Error(`no manifest entry for ${operationId}`);
  return found;
}

async function run(command: CommandDef, args: Record<string, unknown>): Promise<void> {
  await command.run?.({
    args: { json: false, "no-color": false, debug: false, ...args },
  } as never);
}

describe("anomalies rules command group", () => {
  it("has correct meta", () => {
    const meta = rulesCommand.meta as { name: string; description: string };
    expect(meta.name).toBe("rules");
    expect(meta.description).toBe("Tune anomaly-detection sensitivity per project or credential");
  });

  it("lazy-loads every subcommand and alias to a generated leaf", async () => {
    const subCmds = rulesCommand.subCommands as Record<
      string,
      () => Promise<{ meta?: { name?: string } }>
    >;
    expect(Object.keys(subCmds)).toEqual([
      "list",
      "ls",
      "create",
      "add",
      "show",
      "inspect",
      "update",
      "delete",
      "rm",
    ]);
    const resolved = await Promise.all(Object.values(subCmds).map((loader) => loader()));
    expect(resolved.map((c) => c.meta?.name)).toEqual([
      "list",
      "list",
      "create",
      "create",
      "show",
      "show",
      "update",
      "delete",
      "delete",
    ]);
  });
});

describe("anomalies rules commands against the contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists the linked project's rules", async () => {
    request.mockResolvedValue({
      anomaly_rules: [{ id: "anr_1", metric: "bytes_per_hour", enabled: true }],
    });

    await run(buildGeneratedCommand(spec("listAnomalyRules")), {});

    expect(request).toHaveBeenCalledWith("GET /v1/projects/{project_id}/anomaly-rules", {
      pathParams: { project_id: "prj_test" },
      queryParams: {},
    });
    // enabled is the silencer, so the table has to carry it. The generic column
    // pick buried it past MAX_COLUMNS; COMMAND_MAP curates the columns instead.
    const rows = outputTable.mock.calls[0][0] as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({ metric: "bytes_per_hour", enabled: "true" });
  });

  it("sends the scope and sensitivity as the create body", async () => {
    request.mockResolvedValue({ id: "anr_1" });

    await run(buildGeneratedCommand(spec("createAnomalyRule")), {
      metric: "bytes_per_hour",
      "credential-id": "agt_1",
      "sigma-threshold": 4.5,
      floor: 100,
    });

    expect(request).toHaveBeenCalledWith("POST /v1/projects/{project_id}/anomaly-rules", {
      pathParams: { project_id: "prj_test" },
      queryParams: {},
      body: {
        metric: "bytes_per_hour",
        credential_id: "agt_1",
        sigma_threshold: 4.5,
        floor: 100,
      },
    });
  });

  // The metric decides which detector a rule retunes, and a rule naming one the
  // detector does not evaluate is dropped at compile time, silently. A typo must
  // not reach the API as an unknown value.
  it("refuses a metric outside the contract's enum", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await run(buildGeneratedCommand(spec("createAnomalyRule")), {
      metric: "rows_per_fortnight",
    });

    expect(request).not.toHaveBeenCalled();
    exit.mockRestore();
  });

  it("reads one rule by its positional id", async () => {
    request.mockResolvedValue({ id: "anr_1", metric: "bytes_per_hour" });

    await run(buildGeneratedCommand(spec("getAnomalyRule")), { id: "anr_1" });

    expect(request).toHaveBeenCalledWith(
      "GET /v1/projects/{project_id}/anomaly-rules/{anomaly_rule_id}",
      {
        pathParams: { project_id: "prj_test", anomaly_rule_id: "anr_1" },
        queryParams: {},
      },
    );
  });

  // PUT replaces the record. enabled is the silencer here, so an update that
  // dropped it would turn a muted metric back on without the caller asking.
  it("carries the whole input on update", async () => {
    request.mockResolvedValue({ id: "anr_1" });

    await run(buildGeneratedCommand(spec("updateAnomalyRule")), {
      id: "anr_1",
      metric: "bytes_per_hour",
      enabled: false,
    });

    expect(request).toHaveBeenCalledWith(
      "PUT /v1/projects/{project_id}/anomaly-rules/{anomaly_rule_id}",
      {
        pathParams: { project_id: "prj_test", anomaly_rule_id: "anr_1" },
        queryParams: {},
        body: { metric: "bytes_per_hour", enabled: false },
      },
    );
  });

  it("confirms before deleting", async () => {
    request.mockResolvedValue(undefined);

    await run(buildGeneratedCommand(spec("deleteAnomalyRule")), { id: "anr_1", yes: true });

    expect(confirmDestructive).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      "DELETE /v1/projects/{project_id}/anomaly-rules/{anomaly_rule_id}",
      {
        pathParams: { project_id: "prj_test", anomaly_rule_id: "anr_1" },
        queryParams: {},
      },
    );
  });
});
