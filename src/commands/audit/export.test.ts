import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fsFailure = vi.hoisted(() => ({ failWrites: false }));
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return {
    ...fs,
    writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
      if (fsFailure.failWrites) throw new Error("ENOSPC: no space left on device");
      return fs.writeFileSync(...args);
    },
  };
});

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

const posix = process.platform !== "win32";

describe("audit export", () => {
  let dir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    fsFailure.failWrites = false;
    dir = mkdtempSync(join(tmpdir(), "pgbeam-audit-export-"));
    vi.mocked(resolveContext).mockReturnValue({
      client: { agents: { exportAuditLogs: mockExportAuditLogs } } as never,
      orgId: "org_123",
      projectId: "prj_1",
    });
    vi.mocked(requireProject).mockReturnValue("prj_1");
    mockExportAuditLogs.mockResolvedValue(CSV);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes CSV to stdout by default", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await run({ args: { ...baseArgs } } as never);

    expect(mockExportAuditLogs).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_1" },
      queryParams: {},
    });
    expect(writeSpy).toHaveBeenCalledWith(CSV);
    writeSpy.mockRestore();
  });

  it("writes CSV to an owner-only file with --output", async () => {
    const out = join(dir, "audit.csv");

    await run({ args: { ...baseArgs, output: out } } as never);

    expect(readFileSync(out, "utf-8")).toBe(CSV);
    if (posix) expect(statSync(out).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir)).toEqual(["audit.csv"]);
    expect(consola.success).toHaveBeenCalledWith(`Audit log exported to ${out}.`);
  });

  it.skipIf(!posix)("tightens an existing world-readable --output file to 0600", async () => {
    const out = join(dir, "audit.csv");
    writeFileSync(out, "old");
    chmodSync(out, 0o644);

    await run({ args: { ...baseArgs, output: out } } as never);

    expect(readFileSync(out, "utf-8")).toBe(CSV);
    expect(statSync(out).mode & 0o777).toBe(0o600);
  });

  it("leaves an existing --output file untouched when the write fails", async () => {
    const out = join(dir, "audit.csv");
    writeFileSync(out, "previous export");
    fsFailure.failWrites = true;

    await expect(run({ args: { ...baseArgs, output: out } } as never)).rejects.toThrow(/ENOSPC/);

    fsFailure.failWrites = false;
    expect(readFileSync(out, "utf-8")).toBe("previous export");
    expect(readdirSync(dir)).toEqual(["audit.csv"]);
    expect(consola.success).not.toHaveBeenCalled();
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
