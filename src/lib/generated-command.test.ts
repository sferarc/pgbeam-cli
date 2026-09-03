import type { CommandDef } from "citty";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { commandManifest } from "../generated/manifest.gen.js";

const request = vi.fn();
const confirmDestructive = vi.fn();
const output = vi.fn((_data: unknown, json: boolean, tableFn?: () => void) => {
  if (!json && tableFn) tableFn();
});
const outputTable = vi.fn();

vi.mock("./client.js", () => ({
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

vi.mock("./confirm.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./confirm.js")>();
  return {
    ...actual,
    confirmDestructive: (...args: unknown[]) => confirmDestructive(...args),
  };
});

vi.mock("./output.js", () => ({
  output: (...args: [unknown, boolean, (() => void)?]) => output(...args),
  outputTable: (...args: unknown[]) => outputTable(...args),
  // Marked as a date by the manifest; stubbed so a date cell is distinguishable
  // from a plain one in the assertions below.
  formatDate: (value: string) => `fmt:${value}`,
}));

vi.mock("consola", () => ({
  consola: { log: vi.fn(), info: vi.fn(), success: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { buildGeneratedCommand, generatedLeaf } from "./generated-command.js";

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

describe("generated command runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches a list command by its contract route and renders a table", async () => {
    request.mockResolvedValue({ projects: [{ id: "prj_1", name: "app", status: "active" }] });
    const command = buildGeneratedCommand(spec("listProjects"));

    await run(command, { org: "org_test" });

    expect(request).toHaveBeenCalledWith("GET /v1/projects", {
      pathParams: {},
      queryParams: { org_id: "org_test" },
    });
    expect(outputTable).toHaveBeenCalledTimes(1);
    const rows = outputTable.mock.calls[0][0] as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({ id: "prj_1", name: "app" });
  });

  it("uses a positional id and falls back to the linked project for get", async () => {
    request.mockResolvedValue({ id: "prj_9", name: "svc", status: "active" });
    const command = buildGeneratedCommand(spec("getProject"));

    await run(command, { id: "prj_9" });

    expect(request).toHaveBeenCalledWith("GET /v1/projects/{project_id}", {
      pathParams: { project_id: "prj_9" },
      queryParams: {},
    });
  });

  it("threads a sub-resource id through path params from the linked project", async () => {
    request.mockResolvedValue({ agents: [] });
    const command = buildGeneratedCommand(spec("listAgentCredentials"));

    await run(command, {});

    expect(request).toHaveBeenCalledWith("GET /v1/projects/{project_id}/agents", {
      pathParams: { project_id: "prj_test" },
      queryParams: {},
    });
  });

  it("confirms and then issues a destructive delete", async () => {
    request.mockResolvedValue(undefined);
    const command = buildGeneratedCommand(spec("deleteProject"));

    await run(command, { id: "prj_del", yes: true });

    expect(confirmDestructive).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("DELETE /v1/projects/{project_id}", {
      pathParams: { project_id: "prj_del" },
      queryParams: {},
    });
  });

  it("sends a request body assembled from flags", async () => {
    request.mockResolvedValue({ id: "dom_1", domain: "x.example.com", verified: false });
    const command = buildGeneratedCommand(spec("createCustomDomain"));

    await run(command, { domain: "x.example.com" });

    expect(request).toHaveBeenCalledWith("POST /v1/projects/{project_id}/domains", {
      pathParams: { project_id: "prj_test" },
      queryParams: {},
      body: { domain: "x.example.com" },
    });
  });

  it("validates enum query flags against the contract", async () => {
    const command = buildGeneratedCommand(spec("listDatabaseBranches"));
    // A bad enum value exits via runCommand → process.exit; assert the request
    // is never dispatched with an invalid value.
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await run(command, { status: "bogus" });

    expect(request).not.toHaveBeenCalled();
    exit.mockRestore();
  });

  it("follows every page when --all is set", async () => {
    request
      .mockResolvedValueOnce({ branches: [{ id: "brn_1" }], next_page_token: "tok2" })
      .mockResolvedValueOnce({ branches: [{ id: "brn_2" }], next_page_token: "" });
    const command = buildGeneratedCommand(spec("listDatabaseBranches"));

    await run(command, { all: true });

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][1].queryParams).toMatchObject({ page_token: "tok2" });
  });

  it("renders the curated annotation columns and not the id", async () => {
    request.mockResolvedValue({
      annotations: [
        {
          id: "sca_1",
          project_id: "prj_test",
          schema_name: "public",
          table_name: "users",
          column_name: "lifecycle_stage",
          description: "Funnel stage.",
          created_at: "2026-08-22T00:00:00Z",
          updated_at: "2026-08-22T00:00:00Z",
        },
      ],
    });
    const command = buildGeneratedCommand(spec("listSchemaAnnotations"));

    await run(command, {});

    expect(request).toHaveBeenCalledWith("GET /v1/projects/{project_id}/schema-annotations", {
      pathParams: { project_id: "prj_test" },
      queryParams: {},
    });
    const rows = outputTable.mock.calls[0][0] as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({
      schema_name: "public",
      table_name: "users",
      column_name: "lifecycle_stage",
      description: "Funnel stage.",
      updated_at: "fmt:2026-08-22T00:00:00Z",
    });
    // The annotation is addressed by its natural key, so the id is deliberately
    // not a column; --json still carries the whole record.
    expect(rows[0]).not.toHaveProperty("id");
    const columns = outputTable.mock.calls[0][1] as { key: string }[];
    expect(columns.map((c) => c.key)).toEqual([
      "schema_name",
      "table_name",
      "column_name",
      "description",
      "updated_at",
    ]);
  });

  it("sends the annotation key and description as a PUT body", async () => {
    request.mockResolvedValue({ id: "sca_1", table_name: "users", description: "Accounts." });
    const command = buildGeneratedCommand(spec("putSchemaAnnotation"));

    await run(command, {
      "schema-name": "public",
      "table-name": "users",
      description: "Accounts.",
    });

    expect(request).toHaveBeenCalledWith("PUT /v1/projects/{project_id}/schema-annotations", {
      pathParams: { project_id: "prj_test" },
      queryParams: {},
      body: { schema_name: "public", table_name: "users", description: "Accounts." },
    });
  });

  it("deletes an annotation by its natural key, in the query string", async () => {
    request.mockResolvedValue(undefined);
    const command = buildGeneratedCommand(spec("deleteSchemaAnnotation"));

    await run(command, {
      "table-name": "users",
      "schema-name": "public",
      "column-name": "lifecycle_stage",
      yes: true,
    });

    expect(confirmDestructive).toHaveBeenCalledTimes(1);
    // No positional id, so the prompt names the natural key instead, and does
    // not ask for it to be typed back.
    const confirmArgs = confirmDestructive.mock.calls[0][0] as {
      message: string;
      requireMatch?: string;
    };
    expect(confirmArgs.message).toContain("table_name=users");
    expect(confirmArgs.message).toContain("column_name=lifecycle_stage");
    expect(confirmArgs.requireMatch).toBeUndefined();
    expect(request).toHaveBeenCalledWith("DELETE /v1/projects/{project_id}/schema-annotations", {
      pathParams: { project_id: "prj_test" },
      queryParams: {
        table_name: "users",
        schema_name: "public",
        column_name: "lifecycle_stage",
      },
    });
  });

  it("refuses to delete an annotation with no table name", async () => {
    const command = buildGeneratedCommand(spec("deleteSchemaAnnotation"));
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const isTTY = process.stdin.isTTY;
    // A missing required flag prompts on a TTY; assert the non-interactive path.
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

    await run(command, { yes: true });

    expect(request).not.toHaveBeenCalled();
    Object.defineProperty(process.stdin, "isTTY", { value: isTTY, configurable: true });
    exit.mockRestore();
  });

  it("exposes a lazy leaf loader that resolves to a command with meta", async () => {
    const loader = generatedLeaf(["projects", "list"]);
    const command = await loader();
    expect((command.meta as { name?: string }).name).toBe("list");
  });

  it("throws for an unmapped command path", () => {
    expect(() => generatedLeaf(["projects", "nope"])).toThrow(/No generated command/);
  });
});
