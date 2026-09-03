import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("citty", () => ({
  defineCommand: (config: Record<string, unknown>) => config,
}));

vi.mock("../lib/flags.js", () => ({
  globalArgs: {},
}));

vi.mock("node:fs", () => ({
  writeFileSync: vi.fn(),
  chmodSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
  readFileSync: vi.fn(() => JSON.stringify({ version: "0.1.0" })),
}));

vi.mock("node:os", () => ({
  tmpdir: vi.fn(() => "/tmp"),
}));

vi.mock("../lib/constants.js", () => ({
  VERSION: "0.1.0",
}));

vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
}));

vi.mock("consola", () => ({
  consola: {
    start: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
  },
}));

const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
  throw new Error("process.exit");
});

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { confirm } from "@inquirer/prompts";
import { consola } from "consola";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function runHandler(args: Record<string, unknown> = {}) {
  const mod = await import("./update.js");
  const command = mod.default;
  await command.run?.({
    args: { json: false, "no-color": false, debug: false, yes: false, channel: "latest", ...args },
  } as never);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
});

describe("update", () => {
  it("reports already on latest when version matches", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve("0.1.0"),
    });

    await runHandler({ yes: true });

    expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("already on the latest"));
  });

  it("exits with error on an unknown channel instead of silently updating", async () => {
    await expect(runHandler({ channel: "stable", yes: true })).rejects.toThrow("process.exit");

    expect(consola.error).toHaveBeenCalledWith(
      expect.stringContaining('Unknown --channel "stable"'),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
    // It must not have reached out to check for the latest version.
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("exits with error when dev channel has no --version", async () => {
    await expect(runHandler({ channel: "dev", yes: true })).rejects.toThrow("process.exit");

    expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("--version is required"));
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("exits with error when version check fails", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network"));
    mockFetch.mockRejectedValueOnce(new Error("network"));

    await expect(runHandler({ yes: true })).rejects.toThrow("process.exit");

    expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("Failed to check"));
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("fetches and installs a newer version with --yes", async () => {
    // S3 version check
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve("0.2.0"),
    });
    // S3 binary download
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });

    await runHandler({ yes: true });

    expect(consola.info).toHaveBeenCalledWith(expect.stringContaining("0.2.0"));
    expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("Installed"));
  });

  it("allows specifying an explicit version", async () => {
    // S3 binary download
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });

    await runHandler({ yes: true, version: "v0.3.0" });

    expect(consola.info).toHaveBeenCalledWith(expect.stringContaining("0.3.0"));
  });

  it("strips v prefix from explicit version", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });

    await runHandler({ yes: true, version: "v1.2.3" });

    expect(consola.info).toHaveBeenCalledWith(expect.stringContaining("1.2.3"));
  });

  it("falls back to GitHub releases when S3 fails", async () => {
    // S3 version check fails
    mockFetch.mockResolvedValueOnce({ ok: false });
    // GitHub releases succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([{ tag_name: "v0.5.0", prerelease: false }]),
    });
    // S3 binary download
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });

    await runHandler({ yes: true });

    expect(consola.info).toHaveBeenCalledWith(expect.stringContaining("0.5.0"));
  });

  it("installs dev channel build with --version", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });

    await runHandler({ channel: "dev", version: "pr-434", yes: true });

    expect(consola.info).toHaveBeenCalledWith(expect.stringContaining("pr-434"));
    expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("Installed"));
  });

  it("prompts for confirmation when --yes is not set (latest channel)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve("0.2.0"),
    });
    // User confirms
    vi.mocked(confirm).mockResolvedValueOnce(true);
    // Download binary
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });

    await runHandler({ yes: false });

    expect(confirm).toHaveBeenCalled();
    expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("Installed"));
  });

  it("cancels update when user declines confirmation", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve("0.2.0"),
    });
    // User declines
    vi.mocked(confirm).mockResolvedValueOnce(false);

    await runHandler({ yes: false });

    expect(consola.info).toHaveBeenCalledWith("Update cancelled.");
  });

  it("cancels dev channel update when user declines", async () => {
    vi.mocked(confirm).mockResolvedValueOnce(false);

    await runHandler({ channel: "dev", version: "pr-100", yes: false });

    expect(consola.info).toHaveBeenCalledWith("Update cancelled.");
  });

  it("logs current and target versions", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve("0.2.0"),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });

    await runHandler({ yes: true });

    expect(consola.info).toHaveBeenCalledWith(expect.stringContaining("0.1.0"));
    expect(consola.info).toHaveBeenCalledWith(expect.stringContaining("0.2.0"));
  });

  it("does not skip update when explicit version matches current", async () => {
    // When --version is set, always proceed even if same version
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });

    await runHandler({ yes: true, version: "0.1.0" });

    // Should still try to install (not exit with "already latest")
    expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("Installed"));
  });
});

describe("update command metadata", () => {
  it("has correct meta name and description", async () => {
    const mod = await import("./update.js");
    const command = mod.default;
    expect((command.meta as { name: string }).name).toBe("update");
    expect((command.meta as { description: string }).description).toBe(
      "Update the PgBeam CLI to the latest version",
    );
  });

  it("defines yes, channel, and version arguments", async () => {
    const mod = await import("./update.js");
    const command = mod.default;
    const args = command.args as unknown as Record<string, { type: string; default?: unknown }>;
    expect(args.yes).toBeDefined();
    expect(args.yes.type).toBe("boolean");
    expect(args.yes.default).toBe(false);
    expect(args.channel).toBeDefined();
    expect(args.channel.default).toBe("latest");
    expect(args.version).toBeDefined();
    expect(args.version.type).toBe("string");
  });
});
