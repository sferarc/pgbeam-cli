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

const mockCreateProject = vi.fn();
vi.mock("../../lib/client.js", () => ({
  resolveContext: vi.fn(),
  requireOrg: vi.fn(),
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
import { requireOrg, resolveContext } from "../../lib/client.js";
import { output } from "../../lib/output.js";
import createCommand from "./create.js";

const run = createCommand.run;
if (!run) throw new Error("command.run is not defined");

describe("projects create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveContext).mockReturnValue({
      client: {
        projects: { createProject: mockCreateProject },
      } as never,
      orgId: "org_123",
      projectId: null,
    });
    vi.mocked(requireOrg).mockReturnValue("org_123");
  });

  it("creates a project with all args provided", async () => {
    mockCreateProject.mockResolvedValue({
      project: { id: "prj_1", name: "myproject" },
      database: { host: "db.example.com", port: 5432 },
    });

    await run({
      args: {
        name: "myproject",
        host: "db.example.com",
        port: "5432",
        database: "mydb",
        username: "user",
        password: "pass",
        "ssl-mode": "require",
        json: false,
        "no-color": false,
        debug: false,
      },
    } as never);

    expect(mockCreateProject).toHaveBeenCalledWith({
      body: {
        name: "myproject",
        org_id: "org_123",
        database: {
          host: "db.example.com",
          port: 5432,
          name: "mydb",
          username: "user",
          password: "pass",
          ssl_mode: "require",
        },
      },
    });
    expect(consola.success).toHaveBeenCalledWith("Project created: prj_1");
  });

  it("prompts for missing fields interactively", async () => {
    vi.mocked(input)
      .mockResolvedValueOnce("prompted-name")
      .mockResolvedValueOnce("prompted-host")
      .mockResolvedValueOnce("prompted-db")
      .mockResolvedValueOnce("prompted-user");
    vi.mocked(password).mockResolvedValue("prompted-pass");
    vi.mocked(select).mockResolvedValue("require");

    mockCreateProject.mockResolvedValue({
      project: { id: "prj_2", name: "prompted-name" },
      database: null,
    });

    await run({
      args: {
        port: "5432",
        json: false,
        "no-color": false,
        debug: false,
      },
    } as never);

    expect(input).toHaveBeenCalledTimes(4);
    expect(password).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledTimes(1);
    expect(mockCreateProject).toHaveBeenCalledWith({
      body: {
        name: "prompted-name",
        org_id: "org_123",
        database: {
          host: "prompted-host",
          port: 5432,
          name: "prompted-db",
          username: "prompted-user",
          password: "prompted-pass",
          ssl_mode: "require",
        },
      },
    });
  });

  it("outputs JSON when --json flag is set", async () => {
    const result = {
      project: { id: "prj_3", name: "test" },
      database: { host: "h", port: 5432 },
    };
    mockCreateProject.mockResolvedValue(result);

    await run({
      args: {
        name: "test",
        host: "h",
        port: "5432",
        database: "d",
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

  it("handles result without database info", async () => {
    mockCreateProject.mockResolvedValue({
      project: { id: "prj_4", name: "nodb" },
      database: null,
    });

    await run({
      args: {
        name: "nodb",
        host: "h",
        port: "5432",
        database: "d",
        username: "u",
        password: "p",
        "ssl-mode": "require",
        json: false,
        "no-color": false,
        debug: false,
      },
    } as never);

    expect(consola.success).toHaveBeenCalled();
    expect(consola.info).toHaveBeenCalledWith(
      "Next: pgbeam link to link this project to your directory.",
    );
  });
});
