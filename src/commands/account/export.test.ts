import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("citty", () => ({
  defineCommand: (config: Record<string, unknown>) => config,
}));

vi.mock("../../lib/flags.js", () => ({
  globalArgs: {},
}));

vi.mock("node:fs", () => ({
  writeFileSync: vi.fn(),
}));

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

import { writeFileSync } from "node:fs";
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
beforeEach(() => {
  vi.clearAllMocks();
});

describe("account export", () => {
  it("writes to file when --file is provided", async () => {
    setupContext();
    mockExportAccountData.mockResolvedValue(sampleExport);

    await runHandler({ file: "/tmp/export.json" });

    expect(writeFileSync).toHaveBeenCalledWith(
      "/tmp/export.json",
      JSON.stringify(sampleExport, null, 2),
    );
    expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("/tmp/export.json"));
    expect(output).not.toHaveBeenCalled();
  });

  it("calls output without file when --file is not provided", async () => {
    setupContext();
    mockExportAccountData.mockResolvedValue(sampleExport);

    await runHandler({});

    expect(writeFileSync).not.toHaveBeenCalled();
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
