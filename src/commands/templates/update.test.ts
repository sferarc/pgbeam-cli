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
}));

vi.mock("../../lib/stdin.js", () => ({
  readStdin: vi.fn(),
}));

import { consola } from "consola";
import { requireProject, resolveContext } from "../../lib/client.js";
import updateCommand from "./update.js";

const mockClient = {
  policies: {
    getQueryTemplate: vi.fn(),
    updateQueryTemplate: vi.fn(),
  },
};

const current = {
  id: "qtp-1",
  project_id: "proj-1",
  name: "open_orders",
  description: "Open orders for one customer",
  sql: "SELECT id FROM orders WHERE customer_id = $1",
  params: [{ name: "customer_id", type: "bigint" }],
  statement_kind: "select",
  include_sql: false,
  enabled: true,
  created_at: "2026-10-20T00:00:00Z",
  updated_at: "2026-10-20T00:00:00Z",
};

const pathParams = { project_id: "proj-1", query_template_id: "qtp-1" };

async function run(args: Record<string, unknown>, rawArgs: string[] = []) {
  await updateCommand.run?.({
    args: {
      json: false,
      "no-color": false,
      debug: false,
      "clear-params": false,
      id: "qtp-1",
      ...args,
    },
    rawArgs,
  } as never);
}

function putBody() {
  return mockClient.policies.updateQueryTemplate.mock.calls[0]?.[0].body;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveContext).mockReturnValue({
    client: mockClient as never,
    orgId: "org-1",
    projectId: "proj-1",
  });
  vi.mocked(requireProject).mockReturnValue("proj-1");
  mockClient.policies.getQueryTemplate.mockResolvedValue(current);
  mockClient.policies.updateQueryTemplate.mockResolvedValue(current);
});

describe("templates update", () => {
  it("changes only the passed flag and carries every other field from the GET", async () => {
    await run({ enabled: false });

    expect(mockClient.policies.getQueryTemplate).toHaveBeenCalledWith({ pathParams });
    expect(mockClient.policies.updateQueryTemplate).toHaveBeenCalledWith({
      pathParams,
      body: {
        name: "open_orders",
        sql: current.sql,
        params: current.params,
        description: "Open orders for one customer",
        include_sql: false,
        enabled: false,
      },
    });
    expect(consola.success).toHaveBeenCalledWith("Query template qtp-1 updated.");
  });

  it("replaces the whole parameter list when --param is given", async () => {
    await run(
      {
        sql: "SELECT id FROM orders WHERE customer_id = $1 AND status = $2",
        param: "status:text:null",
      },
      ["qtp-1", "--param", "customer_id:bigint", "--param", "status:text:null"],
    );

    expect(putBody()).toMatchObject({
      sql: "SELECT id FROM orders WHERE customer_id = $1 AND status = $2",
      params: [
        { name: "customer_id", type: "bigint" },
        { name: "status", type: "text", nullable: true },
      ],
    });
  });

  it("clears the parameters with --clear-params", async () => {
    await run({ sql: "SELECT id FROM orders", "clear-params": true });

    expect(putBody()).toMatchObject({ sql: "SELECT id FROM orders", params: [] });
  });

  it("renames, re-describes and shows the SQL", async () => {
    await run({ name: "orders_open", description: "", "include-sql": true });

    expect(putBody()).toMatchObject({
      name: "orders_open",
      description: "",
      include_sql: true,
      enabled: true,
    });
  });

  it("refuses --param with --clear-params before any request", async () => {
    await expect(
      run({ param: "customer_id:bigint", "clear-params": true }, [
        "qtp-1",
        "--param",
        "customer_id:bigint",
        "--clear-params",
      ]),
    ).rejects.toThrow(/not both/);

    expect(mockClient.policies.getQueryTemplate).not.toHaveBeenCalled();
  });

  it("refuses an unknown parameter type before any request", async () => {
    await expect(run({ param: "customer_id:serial" })).rejects.toThrow(/Invalid --param type/);

    expect(mockClient.policies.getQueryTemplate).not.toHaveBeenCalled();
    expect(mockClient.policies.updateQueryTemplate).not.toHaveBeenCalled();
  });
});
