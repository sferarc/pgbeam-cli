import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWriteFileSync = vi.fn();
vi.mock("node:fs", () => ({
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
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

vi.mock("../../lib/client.js", () => ({
  resolveContext: vi.fn(),
  requireProject: vi.fn(),
}));

vi.mock("../../lib/errors.js", () => ({
  runCommand: vi.fn(async (fn) => fn()),
}));

import { consola } from "consola";
import { requireProject, resolveContext } from "../../lib/client.js";
import exportCommand from "./export.js";

const run = exportCommand.run;
if (!run) throw new Error("command.run is not defined");

const mockExportAuditLogs = vi.fn();
const baseArgs = { json: false, "no-color": false, debug: false };
const CSV = "id,ts,event\n1,2026-01-01T00:00:00Z,query\n";

describe("audit export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveContext).mockReturnValue({
      client: { agents: { exportAuditLogs: mockExportAuditLogs } } as never,
      orgId: "org_123",
      projectId: "prj_1",
    });
    vi.mocked(requireProject).mockReturnValue("prj_1");
    mockExportAuditLogs.mockResolvedValue(CSV);
  });

  it("writes CSV to stdout by default", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await run({ args: { ...baseArgs } } as never);

    expect(mockExportAuditLogs).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_1" },
      queryParams: {},
    });
    expect(writeSpy).toHaveBeenCalledWith(CSV);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it("writes CSV to a file with --output", async () => {
    await run({ args: { ...baseArgs, output: "audit.csv" } } as never);

    expect(mockWriteFileSync).toHaveBeenCalledWith("audit.csv", CSV);
    expect(consola.success).toHaveBeenCalledWith("Audit log exported to audit.csv.");
  });

  it("forwards all filters as query params", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await run({
      args: {
        ...baseArgs,
        credential: "agt_1",
        event: "blocked",
        decision: "block",
        source: "mcp",
        start: "2026-01-01T00:00:00Z",
        end: "2026-02-01T00:00:00Z",
      },
    } as never);

    expect(mockExportAuditLogs).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_1" },
      queryParams: {
        credential_id: "agt_1",
        event: "blocked",
        decision: "block",
        source: "mcp",
        start: "2026-01-01T00:00:00Z",
        end: "2026-02-01T00:00:00Z",
      },
    });
    writeSpy.mockRestore();
  });

  it("rejects an invalid --decision", async () => {
    await expect(run({ args: { ...baseArgs, decision: "bogus" } } as never)).rejects.toThrow(
      /Invalid decision/,
    );
    expect(mockExportAuditLogs).not.toHaveBeenCalled();
  });

  it("rejects an invalid --source", async () => {
    await expect(run({ args: { ...baseArgs, source: "bogus" } } as never)).rejects.toThrow(
      /Invalid source/,
    );
    expect(mockExportAuditLogs).not.toHaveBeenCalled();
  });
});
