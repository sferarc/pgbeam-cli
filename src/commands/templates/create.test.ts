import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("consola", () => ({
  consola: {
    success: vi.fn(),
    log: vi.fn(),
  },
}));

vi.mock("../../lib/client.js", () => ({
  resolveContext: vi.fn(),
  requireProject: vi.fn(),
}));

vi.mock("../../lib/errors.js", () => ({
  runCommand: vi.fn(async (fn: () => Promise<void>) => fn()),
}));

vi.mock("../../lib/output.js", () => ({
  output: vi.fn((data: unknown, json: boolean, tableFn?: () => void) => {
    void data;
    if (!json && tableFn) tableFn();
  }),
  sanitizeForTerminal: vi.fn((s: string) => s),
}));

vi.mock("../../lib/stdin.js", () => ({
  readStdin: vi.fn(),
}));

import { consola } from "consola";
import { requireProject, resolveContext } from "../../lib/client.js";
import { readStdin } from "../../lib/stdin.js";
import createCommand from "./create.js";

const mockClient = {
  policies: {
    createQueryTemplate: vi.fn(),
  },
};

const created = {
  id: "qtp-1",
  project_id: "proj-1",
  name: "open_orders",
  description: "",
  sql: "SELECT id FROM orders WHERE customer_id = $1",
  params: [{ name: "customer_id", type: "bigint" }],
  statement_kind: "select",
  include_sql: false,
  enabled: true,
  created_at: "2026-10-20T00:00:00Z",
  updated_at: "2026-10-20T00:00:00Z",
};

async function run(args: Record<string, unknown>, rawArgs: string[] = []) {
  await createCommand.run?.({
    args: {
      json: false,
      "no-color": false,
      debug: false,
      "include-sql": false,
      disabled: false,
      name: "open_orders",
      ...args,
    },
    rawArgs,
  } as never);
}

function postBody() {
  return mockClient.policies.createQueryTemplate.mock.calls[0]?.[0].body;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveContext).mockReturnValue({
    client: mockClient as never,
    orgId: "org-1",
    projectId: "proj-1",
  });
  vi.mocked(requireProject).mockReturnValue("proj-1");
  mockClient.policies.createQueryTemplate.mockResolvedValue(created);
});

describe("templates create", () => {
  it("posts every --param in placeholder order with the defaults spelled out", async () => {
    await run({ sql: created.sql, param: "since:timestamptz:null" }, [
      "open_orders",
      "--param",
      "customer_id:bigint",
      "--param=since:timestamptz:null",
    ]);

    expect(mockClient.policies.createQueryTemplate).toHaveBeenCalledWith({
      pathParams: { project_id: "proj-1" },
      body: {
        name: "open_orders",
        sql: created.sql,
        params: [
          { name: "customer_id", type: "bigint" },
          { name: "since", type: "timestamptz", nullable: true },
        ],
        include_sql: false,
        enabled: true,
      },
    });
    expect(consola.success).toHaveBeenCalledWith("Query template created: qtp-1");
    expect(consola.log).toHaveBeenCalledWith("  Params: $1 customer_id bigint");
  });

  it("accepts the two-word double precision type", async () => {
    await run({ sql: created.sql, param: "score:double precision" });

    expect(postBody().params).toEqual([{ name: "score", type: "double precision" }]);
  });

  it("sends an empty params list when no --param is given", async () => {
    await run({ sql: "SELECT 1 FROM orders" });

    expect(postBody().params).toEqual([]);
  });

  it("carries --description, --include-sql and --disabled", async () => {
    await run({
      sql: created.sql,
      description: "Open orders",
      "include-sql": true,
      disabled: true,
    });

    expect(postBody()).toMatchObject({
      description: "Open orders",
      include_sql: true,
      enabled: false,
    });
  });

  it("reads the statement from --sql-file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pgbeam-template-"));
    const path = join(dir, "q.sql");
    writeFileSync(path, "SELECT id\nFROM orders\nWHERE customer_id = $1\n");

    await run({ "sql-file": path, param: "customer_id:bigint" });

    expect(postBody().sql).toBe("SELECT id\nFROM orders\nWHERE customer_id = $1\n");
  });

  it("reads the statement from stdin with --sql-file -", async () => {
    vi.mocked(readStdin).mockResolvedValue("SELECT 1 FROM orders");

    await run({ "sql-file": "-" });

    expect(postBody().sql).toBe("SELECT 1 FROM orders");
  });

  it("refuses an unknown parameter type before any request", async () => {
    await expect(run({ sql: created.sql, param: "customer_id:int8" })).rejects.toThrow(
      /Invalid --param type for "customer_id": "int8"/,
    );

    expect(resolveContext).not.toHaveBeenCalled();
    expect(mockClient.policies.createQueryTemplate).not.toHaveBeenCalled();
  });

  it.each([["customer_id"], [":bigint"], ["customer_id:bigint:optional"], ["a:b:null:x"]])(
    "refuses the malformed --param %s",
    async (value) => {
      await expect(run({ sql: created.sql, param: value })).rejects.toThrow(/Invalid --param/);

      expect(mockClient.policies.createQueryTemplate).not.toHaveBeenCalled();
    },
  );

  it("refuses a missing statement", async () => {
    await expect(run({})).rejects.toThrow(/--sql or --sql-file/);

    expect(mockClient.policies.createQueryTemplate).not.toHaveBeenCalled();
  });

  it("refuses --sql together with --sql-file", async () => {
    await expect(run({ sql: "SELECT 1", "sql-file": "q.sql" })).rejects.toThrow(/not both/);

    expect(mockClient.policies.createQueryTemplate).not.toHaveBeenCalled();
  });

  it("refuses an empty statement file", async () => {
    vi.mocked(readStdin).mockResolvedValue("  \n");

    await expect(run({ "sql-file": "-" })).rejects.toThrow(/is empty/);

    expect(mockClient.policies.createQueryTemplate).not.toHaveBeenCalled();
  });

  it("names an unreadable statement file", async () => {
    await expect(run({ "sql-file": "/nonexistent/q.sql" })).rejects.toThrow(
      /Could not read --sql-file \/nonexistent\/q.sql/,
    );
  });
});
