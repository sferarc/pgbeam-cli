import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(),
  password: vi.fn(),
  select: vi.fn(),
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

const mockCreateDatabase = vi.fn();
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

import { input, password, select } from "@inquirer/prompts";
import { consola } from "consola";
import { requireProject, resolveContext } from "../../lib/client.js";
import { output } from "../../lib/output.js";
import addCommand from "./add.js";

const run = addCommand.run;
if (!run) throw new Error("command.run is not defined");

describe("db add", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveContext).mockReturnValue({
      client: {
        databases: { createDatabase: mockCreateDatabase },
      } as never,
      orgId: "org_123",
      projectId: "prj_1",
    });
    vi.mocked(requireProject).mockReturnValue("prj_1");
  });

  it("adds a database with all args provided", async () => {
    mockCreateDatabase.mockResolvedValue({
      id: "db_1",
      name: "mydb",
      host: "db.example.com",
      port: 5432,
    });

    await run({
      args: {
        host: "db.example.com",
        port: "5432",
        name: "mydb",
        username: "user",
        password: "pass",
        "ssl-mode": "require",
        json: false,
        "no-color": false,
        debug: false,
      },
    } as never);

    expect(mockCreateDatabase).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_1" },
      body: {
        host: "db.example.com",
        port: 5432,
        name: "mydb",
        username: "user",
        password: "pass",
        ssl_mode: "require",
      },
    });
    expect(consola.success).toHaveBeenCalledWith("Database added: db_1");
    expect(consola.info).toHaveBeenCalledWith("Verify: pgbeam db test db_1");
  });

  it("prompts for missing fields interactively", async () => {
    vi.mocked(input)
      .mockResolvedValueOnce("prompted-host")
      .mockResolvedValueOnce("prompted-db")
      .mockResolvedValueOnce("prompted-user");
    vi.mocked(password).mockResolvedValue("prompted-pass");
    vi.mocked(select).mockResolvedValue("require");

    mockCreateDatabase.mockResolvedValue({
      id: "db_2",
      name: "prompted-db",
      host: "prompted-host",
      port: 5432,
    });

    await run({
      args: {
        port: "5432",
        json: false,
        "no-color": false,
        debug: false,
      },
    } as never);

    expect(input).toHaveBeenCalledTimes(3);
    expect(password).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledTimes(1);
    expect(mockCreateDatabase).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_1" },
      body: {
        host: "prompted-host",
        port: 5432,
        name: "prompted-db",
        username: "prompted-user",
        password: "prompted-pass",
        ssl_mode: "require",
      },
    });
  });

  it("outputs JSON when --json flag is set", async () => {
    const result = { id: "db_1", name: "test", host: "h", port: 5432 };
    mockCreateDatabase.mockResolvedValue(result);

    await run({
      args: {
        host: "h",
        port: "5432",
        name: "test",
        username: "u",
        password: "p",
        "ssl-mode": "disable",
        json: true,
        "no-color": false,
        debug: false,
      },
    } as never);

    expect(output).toHaveBeenCalledWith(result, true, expect.any(Function));
  });

  it("requires a linked project", async () => {
    mockCreateDatabase.mockResolvedValue({ id: "db_1", name: "n", host: "h", port: 5432 });

    await run({
      args: {
        host: "h",
        port: "5432",
        name: "n",
        username: "u",
        password: "p",
        "ssl-mode": "require",
        json: false,
        "no-color": false,
        debug: false,
      },
    } as never);

    expect(requireProject).toHaveBeenCalled();
  });
});
