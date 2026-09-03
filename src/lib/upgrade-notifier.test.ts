import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/home/testuser"),
}));

vi.mock("consola", () => ({
  consola: {
    withTag: vi.fn(() => ({ warn: vi.fn() })),
  },
}));

vi.mock("./constants.js", () => ({
  VERSION: "1.0.0",
}));

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { checkForUpdates } from "./upgrade-notifier";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let mockFetch: ReturnType<typeof vi.fn>;

function mockCacheFile(data: { latestVersion: string; checkedAt: number }): void {
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readFileSync).mockReturnValue(JSON.stringify(data));
}

function mockNoCacheFile(): void {
  vi.mocked(existsSync).mockReturnValue(false);
}

function s3Response(version: string): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers({ "content-type": "text/plain" }),
    text: () => Promise.resolve(version),
    json: () => Promise.reject(new Error("not json")),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);

  // Simulate an interactive TTY stderr for update checks
  delete process.env.CI;
  delete process.env.PGBEAM_NO_UPDATE_CHECK;
  delete process.env.XDG_CACHE_HOME;

  // Mock stderr.isTTY
  Object.defineProperty(process.stderr, "isTTY", {
    value: true,
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkForUpdates", () => {
  it("skips when CI env var is set", async () => {
    process.env.CI = "true";

    await checkForUpdates();

    expect(existsSync).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("skips when PGBEAM_NO_UPDATE_CHECK is set", async () => {
    process.env.PGBEAM_NO_UPDATE_CHECK = "1";

    await checkForUpdates();

    expect(existsSync).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("skips when stderr is not a TTY", async () => {
    Object.defineProperty(process.stderr, "isTTY", {
      value: false,
      writable: true,
      configurable: true,
    });

    await checkForUpdates();

    expect(existsSync).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("uses cached result when recent enough (no network call)", async () => {
    // Cache says latest is 1.0.0 (same as current), checked recently
    mockCacheFile({
      latestVersion: "1.0.0",
      checkedAt: Date.now() - 1000, // 1 second ago
    });

    await checkForUpdates();

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("uses cached result and shows notice when newer version is cached", async () => {
    const { consola } = await import("consola");
    const mockWarn = vi.fn();
    vi.mocked(consola.withTag).mockReturnValue({ warn: mockWarn } as never);

    mockCacheFile({
      latestVersion: "2.0.0",
      checkedAt: Date.now() - 1000,
    });

    await checkForUpdates();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(consola.withTag).toHaveBeenCalledWith("update");
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining("2.0.0"));
  });

  it("fetches from S3 when cache is stale", async () => {
    mockNoCacheFile();
    mockFetch.mockResolvedValue(s3Response("1.0.0"));

    await checkForUpdates();

    expect(mockFetch).toHaveBeenCalled();
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("s3.amazonaws.com");
  });

  it("writes new cache after fetching", async () => {
    mockNoCacheFile();
    mockFetch.mockResolvedValue(s3Response("1.1.0"));

    await checkForUpdates();

    expect(mkdirSync).toHaveBeenCalled();
    expect(writeFileSync).toHaveBeenCalled();

    const writtenData = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string);
    expect(writtenData.latestVersion).toBe("1.1.0");
    expect(writtenData.checkedAt).toBeGreaterThan(0);
  });

  it("falls back to GitHub when S3 fails", async () => {
    mockNoCacheFile();

    // S3 fails
    mockFetch.mockRejectedValueOnce(new Error("S3 unreachable"));

    // GitHub succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.resolve([{ tag_name: "v1.2.0" }, { tag_name: "v1.1.0" }]),
      text: () => Promise.resolve("[]"),
    } as unknown as Response);

    await checkForUpdates();

    // Should have tried S3, then GitHub
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Cache should be written with GitHub result
    expect(writeFileSync).toHaveBeenCalled();
    const writtenData = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string);
    expect(writtenData.latestVersion).toBe("1.2.0");
  });

  it("does not crash when both sources fail", async () => {
    mockNoCacheFile();

    mockFetch.mockRejectedValueOnce(new Error("S3 down"));
    mockFetch.mockRejectedValueOnce(new Error("GitHub down"));

    // Should not throw
    await checkForUpdates();

    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it("handles invalid S3 version gracefully", async () => {
    mockNoCacheFile();

    // S3 returns garbage
    mockFetch.mockResolvedValueOnce(s3Response("not-a-version"));

    // GitHub returns a valid tag
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.resolve([{ tag_name: "v1.3.0" }]),
    } as unknown as Response);

    await checkForUpdates();

    // Should have tried both
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does not show notice when latest is the same as current", async () => {
    const { consola } = await import("consola");
    const mockWarn = vi.fn();
    vi.mocked(consola.withTag).mockReturnValue({ warn: mockWarn } as never);

    mockNoCacheFile();
    mockFetch.mockResolvedValue(s3Response("1.0.0"));

    await checkForUpdates();

    expect(mockWarn).not.toHaveBeenCalled();
  });

  it("does not show notice when latest is older than current", async () => {
    const { consola } = await import("consola");
    const mockWarn = vi.fn();
    vi.mocked(consola.withTag).mockReturnValue({ warn: mockWarn } as never);

    mockNoCacheFile();
    mockFetch.mockResolvedValue(s3Response("0.9.0"));

    await checkForUpdates();

    expect(mockWarn).not.toHaveBeenCalled();
  });
});
