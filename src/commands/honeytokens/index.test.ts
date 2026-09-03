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
import honeytokensCommand from "./index.js";

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

describe("honeytokens command group", () => {
  it("has correct meta", () => {
    const meta = honeytokensCommand.meta as { name: string; description: string };
    expect(meta.name).toBe("honeytokens");
    expect(meta.description).toBe("Manage decoy (canary) relations");
  });

  it("lazy-loads every subcommand and alias to a generated leaf", async () => {
    const subCmds = honeytokensCommand.subCommands as Record<
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

describe("honeytokens commands against the contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists the linked project's honeytokens", async () => {
    request.mockResolvedValue({
      honeytokens: [{ id: "hnt_1", relation_name: "customer_ssns", action: "kill" }],
    });

    await run(buildGeneratedCommand(spec("listHoneytokens")), {});

    expect(request).toHaveBeenCalledWith("GET /v1/projects/{project_id}/honeytokens", {
      pathParams: { project_id: "prj_test" },
      queryParams: {},
    });
    const rows = outputTable.mock.calls[0][0] as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({ relation_name: "customer_ssns", action: "kill" });
  });

  it("sends relation and action as the create body", async () => {
    request.mockResolvedValue({ id: "hnt_1" });

    await run(buildGeneratedCommand(spec("createHoneytoken")), {
      "schema-name": "public",
      "relation-name": "customer_ssns",
      action: "kill",
    });

    expect(request).toHaveBeenCalledWith("POST /v1/projects/{project_id}/honeytokens", {
      pathParams: { project_id: "prj_test" },
      queryParams: {},
      body: { schema_name: "public", relation_name: "customer_ssns", action: "kill" },
    });
  });

  // The action decides whether a trip only audits or also disables the tripping
  // credential, so a typo must not reach the API as an unknown value.
  it("refuses an action outside the contract's enum", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await run(buildGeneratedCommand(spec("createHoneytoken")), {
      "relation-name": "customer_ssns",
      action: "disable",
    });

    expect(request).not.toHaveBeenCalled();
    exit.mockRestore();
  });

  it("reads one honeytoken by its positional id", async () => {
    request.mockResolvedValue({ id: "hnt_1", relation_name: "customer_ssns", action: "kill" });

    await run(buildGeneratedCommand(spec("getHoneytoken")), { id: "hnt_1" });

    expect(request).toHaveBeenCalledWith(
      "GET /v1/projects/{project_id}/honeytokens/{honeytoken_id}",
      {
        pathParams: { project_id: "prj_test", honeytoken_id: "hnt_1" },
        queryParams: {},
      },
    );
  });

  // PUT replaces the record, so the CLI must carry the whole input rather than
  // letting a partial update blank the relation the decoy is named after.
  it("requires the full input on update", async () => {
    request.mockResolvedValue({ id: "hnt_1" });

    await run(buildGeneratedCommand(spec("updateHoneytoken")), {
      id: "hnt_1",
      "relation-name": "customer_ssns",
      action: "audit_only",
    });

    expect(request).toHaveBeenCalledWith(
      "PUT /v1/projects/{project_id}/honeytokens/{honeytoken_id}",
      {
        pathParams: { project_id: "prj_test", honeytoken_id: "hnt_1" },
        queryParams: {},
        body: { relation_name: "customer_ssns", action: "audit_only" },
      },
    );
  });

  it("confirms before deleting", async () => {
    request.mockResolvedValue(undefined);

    await run(buildGeneratedCommand(spec("deleteHoneytoken")), { id: "hnt_1", yes: true });

    expect(confirmDestructive).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      "DELETE /v1/projects/{project_id}/honeytokens/{honeytoken_id}",
      {
        pathParams: { project_id: "prj_test", honeytoken_id: "hnt_1" },
        queryParams: {},
      },
    );
  });
});
