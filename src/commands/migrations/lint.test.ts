import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

vi.mock("consola", () => ({
  consola: {
    success: vi.fn(),
    warn: vi.fn(),
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

// Note: ../../lib/args.js is intentionally NOT mocked so the real optionalArg
// behaviour is exercised.

import { readFile } from "node:fs/promises";
import { consola } from "consola";
import { requireProject, resolveContext } from "../../lib/client.js";
import lintCommand from "./lint.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mockClient = {
  migrations: {
    lintMigration: vi.fn(),
  },
};

function buildArgs(overrides: Record<string, unknown> = {}) {
  return {
    json: false,
    "no-color": false,
    debug: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveContext).mockReturnValue({
    client: mockClient as never,
    orgId: "org-1",
    projectId: "proj-1",
  });
  vi.mocked(requireProject).mockReturnValue("proj-1");
  mockClient.migrations.lintMigration.mockResolvedValue({ safe: true, findings: [] });
});

describe("migrations lint", () => {
  it("lints inline SQL passed as positional arg (trimmed)", async () => {
    await lintCommand.run?.({
      args: buildArgs({ sql: "  ALTER TABLE users ADD COLUMN x int;  " }),
    } as never);

    expect(mockClient.migrations.lintMigration).toHaveBeenCalledWith({
      pathParams: { project_id: "proj-1" },
      body: { sql: "ALTER TABLE users ADD COLUMN x int;" },
    });
  });

  it("reads SQL from --file when provided", async () => {
    vi.mocked(readFile).mockResolvedValue("DROP TABLE users;\n" as never);

    await lintCommand.run?.({
      args: buildArgs({ file: "./0001.sql" }),
    } as never);

    expect(readFile).toHaveBeenCalledWith("./0001.sql", "utf8");
    expect(mockClient.migrations.lintMigration).toHaveBeenCalledWith({
      pathParams: { project_id: "proj-1" },
      body: { sql: "DROP TABLE users;" },
    });
  });

  it("prefers --file over positional sql", async () => {
    vi.mocked(readFile).mockResolvedValue("SELECT 1;" as never);

    await lintCommand.run?.({
      args: buildArgs({ sql: "SELECT 2;", file: "./x.sql" }),
    } as never);

    expect(readFile).toHaveBeenCalledWith("./x.sql", "utf8");
    expect(mockClient.migrations.lintMigration).toHaveBeenCalledWith({
      pathParams: { project_id: "proj-1" },
      body: { sql: "SELECT 1;" },
    });
  });

  it("adds database_id to the body when --database is set", async () => {
    await lintCommand.run?.({
      args: buildArgs({ sql: "SELECT 1;", database: "db_xxx" }),
    } as never);

    expect(mockClient.migrations.lintMigration).toHaveBeenCalledWith({
      pathParams: { project_id: "proj-1" },
      body: { sql: "SELECT 1;", database_id: "db_xxx" },
    });
  });

  it("throws when no SQL is provided", async () => {
    await expect(lintCommand.run?.({ args: buildArgs() } as never)).rejects.toThrow(
      "Provide SQL as an argument or via --file",
    );
    expect(mockClient.migrations.lintMigration).not.toHaveBeenCalled();
  });

  it("prints a success message when the migration is safe", async () => {
    mockClient.migrations.lintMigration.mockResolvedValue({ safe: true, findings: [] });

    await lintCommand.run?.({ args: buildArgs({ sql: "SELECT 1;" }) } as never);

    expect(consola.success).toHaveBeenCalledWith("Migration is safe — no blocking findings.");
    expect(consola.warn).not.toHaveBeenCalled();
  });

  it("warns and prints findings when the migration is unsafe", async () => {
    mockClient.migrations.lintMigration.mockResolvedValue({
      safe: false,
      findings: [
        {
          severity: "error",
          rule: "no-null-without-default",
          message: "Adding a NOT NULL column without a default rewrites the table.",
          hint: "Add a default or backfill in batches.",
          statement: "ALTER TABLE users ADD COLUMN age int NOT NULL;",
        },
      ],
    });

    await lintCommand.run?.({
      args: buildArgs({ sql: "ALTER TABLE users ADD COLUMN age int NOT NULL;" }),
    } as never);

    expect(consola.warn).toHaveBeenCalledWith("Migration has findings:");
    expect(consola.log).toHaveBeenCalledWith(
      expect.stringContaining("[error] no-null-without-default:"),
    );
    expect(consola.log).toHaveBeenCalledWith(expect.stringContaining("hint:"));
    expect(consola.log).toHaveBeenCalledWith(expect.stringContaining("statement:"));
    expect(consola.success).not.toHaveBeenCalled();
  });

  it("outputs JSON when --json flag is set", async () => {
    const result = { safe: true, findings: [] };
    mockClient.migrations.lintMigration.mockResolvedValue(result);

    const { output } = await import("../../lib/output.js");
    await lintCommand.run?.({ args: buildArgs({ sql: "SELECT 1;", json: true }) } as never);

    expect(output).toHaveBeenCalledWith(result, true, expect.any(Function));
  });
});
