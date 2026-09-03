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

const mockUpdateDatabase = vi.fn();
const mockGetDatabase = vi.fn();
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

describe("db update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveContext).mockReturnValue({
      client: {
        databases: {
          updateDatabase: mockUpdateDatabase,
          getDatabase: mockGetDatabase,
        },
      } as never,
      orgId: "org_123",
      projectId: "prj_1",
    });
    vi.mocked(requireProject).mockReturnValue("prj_1");
    mockGetDatabase.mockResolvedValue({
      id: "db_1",
      name: "current",
      cache_config: { enabled: false, ttl_seconds: 60 },
      pool_config: { pool_mode: "session", pool_size: 10, min_pool_size: 1 },
    });
  });

  it("updates database name", async () => {
    mockUpdateDatabase.mockResolvedValue({ id: "db_1", name: "new-name" });

    await run({
      args: { id: "db_1", name: "new-name", json: false, "no-color": false, debug: false },
    } as never);

    expect(mockUpdateDatabase).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_1", database_id: "db_1" },
      body: { name: "new-name" },
    });
    expect(consola.success).toHaveBeenCalledWith("Database db_1 updated.");
  });

  it("updates cache configuration", async () => {
    mockUpdateDatabase.mockResolvedValue({ id: "db_1" });

    await run({
      args: {
        id: "db_1",
        "cache-enabled": true,
        "cache-ttl": "120",
        json: false,
        "no-color": false,
        debug: false,
      },
    } as never);

    expect(mockGetDatabase).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_1", database_id: "db_1" },
    });
    expect(mockUpdateDatabase).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_1", database_id: "db_1" },
      body: {
        cache_config: { enabled: true, ttl_seconds: 120 },
      },
    });
  });

  it("updates pool configuration", async () => {
    mockUpdateDatabase.mockResolvedValue({ id: "db_1" });

    await run({
      args: {
        id: "db_1",
        "pool-mode": "transaction",
        "pool-size": "20",
        "min-pool-size": "5",
        json: false,
        "no-color": false,
        debug: false,
      },
    } as never);

    expect(mockUpdateDatabase).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_1", database_id: "db_1" },
      body: {
        pool_config: { pool_mode: "transaction", pool_size: 20, min_pool_size: 5 },
      },
    });
  });

  it("exits with error when no update fields provided", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(
      run({
        args: { id: "db_1", json: false, "no-color": false, debug: false },
      } as never),
    ).rejects.toThrow("process.exit");

    expect(consola.error).toHaveBeenCalledWith(
      "Nothing to update. Pass --name, --cache-enabled, --cache-ttl, or --pool-mode.",
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockUpdateDatabase).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it("merges cache config with current values", async () => {
    mockGetDatabase.mockResolvedValue({
      id: "db_1",
      cache_config: { enabled: true, ttl_seconds: 60 },
      pool_config: null,
    });
    mockUpdateDatabase.mockResolvedValue({ id: "db_1" });

    await run({
      args: {
        id: "db_1",
        "cache-ttl": "300",
        json: false,
        "no-color": false,
        debug: false,
      },
    } as never);

    expect(mockUpdateDatabase).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_1", database_id: "db_1" },
      body: {
        cache_config: { enabled: true, ttl_seconds: 300 },
      },
    });
  });

  it("outputs JSON when --json flag is set", async () => {
    const result = { id: "db_1", name: "updated" };
    mockUpdateDatabase.mockResolvedValue(result);

    await run({
      args: { id: "db_1", name: "updated", json: true, "no-color": false, debug: false },
    } as never);

    expect(output).toHaveBeenCalledWith(result, true, expect.any(Function));
  });
});
