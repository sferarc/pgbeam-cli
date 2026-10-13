import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("consola", () => ({
  consola: {
    log: vi.fn(),
    info: vi.fn(),
    start: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("node:fs", () => ({
  copyFileSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("node:os", () => ({ tmpdir: () => "/tmp" }));

vi.mock("../lib/confirm.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/confirm.js")>()),
  confirmDestructive: vi.fn(),
}));

import { copyFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { consola } from "consola";
import { ConfirmationRequiredError, confirmDestructive } from "../lib/confirm.js";
import updateCommand, {
  detectAsset,
  fetchExpectedChecksum,
  InstallPermissionError,
  IntegrityError,
  installFromS3,
  moveFile,
} from "./update.js";

const BINARY = new TextEncoder().encode("new pgbeam binary");
const BINARY_SHA = createHash("sha256").update(BINARY).digest("hex");
const TARGET = "/usr/local/bin/pgbeam";
const asset = detectAsset();

function fsError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

function mockFetch(sums: string | null): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith("/SHA256SUMS")) {
      return sums === null
        ? new Response("Not Found", { status: 404, statusText: "Not Found" })
        : new Response(sums);
    }
    return new Response(BINARY);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(renameSync).mockImplementation(() => undefined);
  vi.mocked(writeFileSync).mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchExpectedChecksum", () => {
  it("returns the digest for the matching asset", async () => {
    mockFetch(`${"a".repeat(64)}  pgbeam-other\n${BINARY_SHA}  ${asset}\n`);
    await expect(fetchExpectedChecksum("1.2.3", asset)).resolves.toBe(BINARY_SHA);
    expect(fetch).toHaveBeenCalledWith(
      "https://github.com/sferarc/pgbeam-cli/releases/download/v1.2.3/SHA256SUMS",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("refuses when the asset has no entry", async () => {
    mockFetch(`${"a".repeat(64)}  pgbeam-other\n`);
    await expect(fetchExpectedChecksum("1.2.3", asset)).rejects.toThrow(IntegrityError);
  });

  it("refuses when SHA256SUMS is missing", async () => {
    mockFetch(null);
    await expect(fetchExpectedChecksum("1.2.3", asset)).rejects.toThrow(/404/);
  });
});

describe("installFromS3", () => {
  it("installs beside the target when the checksum matches", async () => {
    mockFetch(`${BINARY_SHA}  ${asset}\n`);
    await installFromS3("v1.2.3", { verifyVersion: "1.2.3", target: TARGET });

    const staged = vi.mocked(writeFileSync).mock.calls[0][0] as string;
    expect(staged.startsWith("/usr/local/bin/.pgbeam-update-")).toBe(true);
    expect(renameSync).toHaveBeenCalledWith(staged, TARGET);
    for (const call of vi.mocked(fetch).mock.calls) {
      expect(call[1]).toEqual(expect.objectContaining({ signal: expect.any(AbortSignal) }));
    }
  });

  it("refuses a checksum mismatch without writing anything", async () => {
    mockFetch(`${"0".repeat(64)}  ${asset}\n`);
    await expect(
      installFromS3("v1.2.3", { verifyVersion: "1.2.3", target: TARGET }),
    ).rejects.toThrow(/Checksum mismatch/);
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(renameSync).not.toHaveBeenCalled();
  });

  it("refuses before downloading when the asset has no checksum entry", async () => {
    const fetchMock = mockFetch(`${BINARY_SHA}  pgbeam-other\n`);
    await expect(
      installFromS3("v1.2.3", { verifyVersion: "1.2.3", target: TARGET }),
    ).rejects.toThrow(IntegrityError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it("removes the staged file when the final rename fails", async () => {
    mockFetch(`${BINARY_SHA}  ${asset}\n`);
    vi.mocked(renameSync).mockImplementation(() => {
      throw fsError("EBUSY");
    });
    await expect(
      installFromS3("v1.2.3", { verifyVersion: "1.2.3", target: TARGET }),
    ).rejects.toThrow("EBUSY");
    const staged = vi.mocked(writeFileSync).mock.calls[0][0];
    expect(unlinkSync).toHaveBeenCalledWith(staged);
  });

  it("falls back to tmpdir and copies across filesystems on EXDEV", async () => {
    mockFetch(`${BINARY_SHA}  ${asset}\n`);
    vi.mocked(writeFileSync).mockImplementationOnce(() => {
      throw fsError("EACCES");
    });
    vi.mocked(renameSync).mockImplementationOnce(() => {
      throw fsError("EXDEV");
    });
    await installFromS3("v1.2.3", { verifyVersion: "1.2.3", target: TARGET });

    const tmpFile = vi.mocked(writeFileSync).mock.calls[1][0] as string;
    expect(tmpFile.startsWith("/tmp/.pgbeam-update-")).toBe(true);
    expect(copyFileSync).toHaveBeenCalledWith(tmpFile, `${TARGET}.pgbeam-update`);
    expect(renameSync).toHaveBeenLastCalledWith(`${TARGET}.pgbeam-update`, TARGET);
    expect(unlinkSync).toHaveBeenCalledWith(tmpFile);
  });

  it("explains how to proceed when the install directory is not writable", async () => {
    mockFetch(`${BINARY_SHA}  ${asset}\n`);
    vi.mocked(writeFileSync).mockImplementationOnce(() => {
      throw fsError("EACCES");
    });
    vi.mocked(renameSync).mockImplementationOnce(() => {
      throw fsError("EXDEV");
    });
    vi.mocked(copyFileSync).mockImplementationOnce(() => {
      throw fsError("EACCES");
    });
    const err = await installFromS3("v1.2.3", { verifyVersion: "1.2.3", target: TARGET }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(InstallPermissionError);
    expect((err as Error).message).toMatch(/sudo.*pgbeam\.com\/install/);
    expect(unlinkSync).toHaveBeenCalledWith(vi.mocked(writeFileSync).mock.calls[1][0]);
  });
});

describe("moveFile", () => {
  it("renames directly on the same filesystem", () => {
    moveFile("/a", "/b");
    expect(renameSync).toHaveBeenCalledWith("/a", "/b");
    expect(copyFileSync).not.toHaveBeenCalled();
  });

  it("rethrows errors other than EXDEV", () => {
    vi.mocked(renameSync).mockImplementationOnce(() => {
      throw fsError("ENOENT");
    });
    expect(() => moveFile("/a", "/b")).toThrow("ENOENT");
    expect(copyFileSync).not.toHaveBeenCalled();
  });
});

describe("update --channel dev", () => {
  const exit = vi.spyOn(process, "exit");

  beforeEach(() => {
    exit.mockImplementation((() => {
      throw new Error("exit");
    }) as never);
  });

  afterEach(() => {
    exit.mockReset();
  });

  type RunContext = Parameters<NonNullable<typeof updateCommand.run>>[0];
  const run = (args: Record<string, unknown>) => updateCommand.run?.({ args } as RunContext);

  it("warns that the build is unverified and installs once confirmed", async () => {
    const fetchMock = mockFetch(null);
    vi.mocked(confirmDestructive).mockResolvedValue();
    await run({ channel: "dev", version: "pr-1", yes: false });

    expect(consola.warn).toHaveBeenCalledWith(expect.stringMatching(/cannot be verified/));
    expect(confirmDestructive).toHaveBeenCalledWith(expect.objectContaining({ yes: false }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/cli\/pr-1\//);
    expect(renameSync).toHaveBeenCalled();
  });

  it("refuses without --yes when it cannot prompt", async () => {
    const fetchMock = mockFetch(null);
    vi.mocked(confirmDestructive).mockRejectedValue(
      new ConfirmationRequiredError("Installing an unverified dev build"),
    );
    await expect(run({ channel: "dev", version: "pr-1", yes: false })).rejects.toThrow("exit");
    expect(exit).toHaveBeenCalledWith(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
