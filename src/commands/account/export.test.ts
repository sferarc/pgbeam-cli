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

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("citty", () => ({
  defineCommand: (config: Record<string, unknown>) => config,
}));

vi.mock("../../lib/flags.js", () => ({
  globalArgs: {},
}));

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

vi.mock("../../lib/client.js", () => ({
  resolveContext: vi.fn(),
}));

vi.mock("../../lib/errors.js", () => ({
  runCommand: vi.fn(async (fn: () => Promise<void>) => fn()),
}));

vi.mock("../../lib/output.js", () => ({
  output: vi.fn(),
  formatDate: vi.fn((value: unknown) => String(value ?? "-")),
}));

vi.mock("consola", () => ({
  consola: { success: vi.fn(), log: vi.fn(), info: vi.fn() },
}));

import { consola } from "consola";
import { resolveContext } from "../../lib/client.js";
import { output } from "../../lib/output.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mockExportAccountData = vi.fn();

function setupContext() {
  vi.mocked(resolveContext).mockReturnValue({
    client: {
      account: { exportAccountData: mockExportAccountData },
    },
    orgId: "org-1",
    projectId: null,
  } as never);
}

const sampleExport = {
  user: { name: "Test User", email: "test@example.com" },
  organizations: [{ id: "org-1" }],
  projects: [{ id: "proj-1" }],
  databases: [{ id: "db-1" }],
  sessions: [{ id: "sess-1" }],
  audit_logs: [{ id: "log-1" }],
  exported_at: "2024-01-01T00:00:00Z",
};

async function runHandler(args: Record<string, unknown>) {
  const mod = await import("./export.js");
  const command = mod.default;
  await command.run?.({ args: { json: false, "no-color": false, debug: false, ...args } } as never);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
const posix = process.platform !== "win32";
let dir: string;

beforeEach(() => {
  vi.clearAllMocks();
  fsFailure.failWrites = false;
  dir = mkdtempSync(join(tmpdir(), "pgbeam-account-export-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("account export", () => {
  it("writes an owner-only file when --file is provided", async () => {
    setupContext();
    mockExportAccountData.mockResolvedValue(sampleExport);
    const out = join(dir, "export.json");

    await runHandler({ file: out });

    expect(readFileSync(out, "utf-8")).toBe(JSON.stringify(sampleExport, null, 2));
    if (posix) expect(statSync(out).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir)).toEqual(["export.json"]);
    expect(consola.success).toHaveBeenCalledWith(expect.stringContaining(out));
    expect(output).not.toHaveBeenCalled();
  });

  it.skipIf(!posix)("tightens an existing world-readable --file to 0600", async () => {
    setupContext();
    mockExportAccountData.mockResolvedValue(sampleExport);
    const out = join(dir, "export.json");
    writeFileSync(out, "{}");
    chmodSync(out, 0o644);

    await runHandler({ file: out });

    expect(readFileSync(out, "utf-8")).toBe(JSON.stringify(sampleExport, null, 2));
    expect(statSync(out).mode & 0o777).toBe(0o600);
  });

  it("leaves an existing --file untouched when the write fails", async () => {
    setupContext();
    mockExportAccountData.mockResolvedValue(sampleExport);
    const out = join(dir, "export.json");
    writeFileSync(out, "previous export");
    fsFailure.failWrites = true;

    await expect(runHandler({ file: out })).rejects.toThrow(/ENOSPC/);

    fsFailure.failWrites = false;
    expect(readFileSync(out, "utf-8")).toBe("previous export");
    expect(readdirSync(dir)).toEqual(["export.json"]);
    expect(consola.success).not.toHaveBeenCalled();
  });

  it("calls output without file when --file is not provided", async () => {
    setupContext();
    mockExportAccountData.mockResolvedValue(sampleExport);

    await runHandler({});

    expect(output).toHaveBeenCalledWith(sampleExport, false, expect.any(Function));
  });

  it("passes json flag to output", async () => {
    setupContext();
    mockExportAccountData.mockResolvedValue(sampleExport);

    await runHandler({ json: true });

    expect(output).toHaveBeenCalledWith(sampleExport, true, expect.any(Function));
  });

  it("calls exportAccountData on the SDK client", async () => {
    setupContext();
    mockExportAccountData.mockResolvedValue(sampleExport);

    await runHandler({});

    expect(mockExportAccountData).toHaveBeenCalledOnce();
  });

  it("table callback logs summary of exported data", async () => {
    setupContext();
    mockExportAccountData.mockResolvedValue(sampleExport);
    await runHandler({});

    const tableFn = vi.mocked(output).mock.calls[0][2] as () => void;
    tableFn();
    expect(consola.log).toHaveBeenCalledWith(expect.stringContaining("Test User"));
    expect(consola.log).toHaveBeenCalledWith(expect.stringContaining("test@example.com"));
    expect(consola.info).toHaveBeenCalledWith(expect.stringContaining("--json"));
  });
});
