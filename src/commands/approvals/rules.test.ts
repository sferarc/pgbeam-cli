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

describe("approvals rules command group", () => {
  it("has correct meta", () => {
    const meta = rulesCommand.meta as { name: string; description: string };
    expect(meta.name).toBe("rules");
    expect(meta.description).toBe("Author rules that send matching agent statements to a human");
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

describe("approvals rules commands against the contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists the linked project's rules with enabled and the threshold visible", async () => {
    request.mockResolvedValue({
      approval_rules: [
        { id: "apl_1", name: "bulk updates", min_affected_rows: 1000, enabled: false },
      ],
    });

    await run(buildGeneratedCommand(spec("listApprovalRules")), {});

    expect(request).toHaveBeenCalledWith("GET /v1/projects/{project_id}/approval-rules", {
      pathParams: { project_id: "prj_test" },
      queryParams: {},
    });
    const rows = outputTable.mock.calls[0][0] as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({
      name: "bulk updates",
      min_affected_rows: "1000",
      enabled: "false",
    });
  });

  it("sends the kinds as a list and the scope as the create body", async () => {
    request.mockResolvedValue({ id: "apl_1" });

    await run(buildGeneratedCommand(spec("createApprovalRule")), {
      name: "payments deletes",
      "statement-kinds": "delete,ddl",
      "relation-name": "payments",
      "min-affected-rows": 10,
    });

    expect(request).toHaveBeenCalledWith("POST /v1/projects/{project_id}/approval-rules", {
      pathParams: { project_id: "prj_test" },
      queryParams: {},
      body: {
        name: "payments deletes",
        statement_kinds: ["delete", "ddl"],
        relation_name: "payments",
        min_affected_rows: 10,
      },
    });
  });

  // An unknown kind would be stored as a rule that holds nothing, so a typo must not reach the API.
  it("refuses a statement kind outside the contract's enum", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await run(buildGeneratedCommand(spec("createApprovalRule")), {
      name: "r",
      "statement-kinds": "delete,dleete",
    });

    expect(request).not.toHaveBeenCalled();
    exit.mockRestore();
  });

  it("carries the whole input on update", async () => {
    request.mockResolvedValue({ id: "apl_1" });

    await run(buildGeneratedCommand(spec("updateApprovalRule")), {
      id: "apl_1",
      name: "payments deletes",
      enabled: false,
    });

    expect(request).toHaveBeenCalledWith(
      "PUT /v1/projects/{project_id}/approval-rules/{approval_rule_id}",
      {
        pathParams: { project_id: "prj_test", approval_rule_id: "apl_1" },
        queryParams: {},
        body: { name: "payments deletes", enabled: false },
      },
    );
  });

  it("confirms before deleting", async () => {
    request.mockResolvedValue(undefined);

    await run(buildGeneratedCommand(spec("deleteApprovalRule")), { id: "apl_1", yes: true });

    expect(confirmDestructive).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      "DELETE /v1/projects/{project_id}/approval-rules/{approval_rule_id}",
      {
        pathParams: { project_id: "prj_test", approval_rule_id: "apl_1" },
        queryParams: {},
      },
    );
  });
});
