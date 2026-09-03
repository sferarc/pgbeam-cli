import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("consola", () => ({
  consola: { warn: vi.fn() },
}));

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { consola } from "consola";
import { loadProjectLink, removeProjectLink, saveProjectLink } from "./project";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const cwd = "/tmp/my-project";
const projectLink = { projectId: "proj-abc", orgId: "org-123" };

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// loadProjectLink
// ---------------------------------------------------------------------------
describe("loadProjectLink", () => {
  it("returns null when no file exists", () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const result = loadProjectLink(cwd);

    expect(result).toBeNull();
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it("returns parsed link from valid JSON", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(projectLink));

    const result = loadProjectLink(cwd);

    expect(result).toEqual(projectLink);
    expect(existsSync).toHaveBeenCalledWith(expect.stringContaining(".pgbeam/project.json"));
  });

  it("returns null and warns on corrupted JSON", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue("{{invalid json");

    const result = loadProjectLink(cwd);

    expect(result).toBeNull();
    expect(consola.warn).toHaveBeenCalledWith(
      expect.stringContaining("Corrupted .pgbeam/project.json"),
    );
  });

  it("walks ancestor directories to find the link, like git does", () => {
    const target = "/tmp/my-project/.pgbeam/project.json";
    vi.mocked(existsSync).mockImplementation((p) => p === target);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(projectLink));

    const result = loadProjectLink("/tmp/my-project/apps/web/src");

    expect(result).toEqual(projectLink);
    expect(readFileSync).toHaveBeenCalledWith(target, "utf-8");
    // It probed each level between cwd and the link before finding it.
    expect(existsSync).toHaveBeenCalledWith("/tmp/my-project/apps/web/src/.pgbeam/project.json");
    expect(existsSync).toHaveBeenCalledWith("/tmp/my-project/apps/web/.pgbeam/project.json");
    expect(existsSync).toHaveBeenCalledWith("/tmp/my-project/apps/.pgbeam/project.json");
  });

  it("returns null when no ancestor up to the root has a link", () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const result = loadProjectLink("/tmp/deep/nested/dir");

    expect(result).toBeNull();
    expect(existsSync).toHaveBeenCalledWith("/.pgbeam/project.json");
    expect(readFileSync).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// saveProjectLink
// ---------------------------------------------------------------------------
describe("saveProjectLink", () => {
  it("creates directory and writes file", () => {
    saveProjectLink(projectLink, cwd);

    expect(mkdirSync).toHaveBeenCalledWith(expect.stringContaining(".pgbeam"), { recursive: true });
    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining(".pgbeam/project.json"),
      `${JSON.stringify(projectLink, null, 2)}\n`,
    );
  });
});

// ---------------------------------------------------------------------------
// removeProjectLink
// ---------------------------------------------------------------------------
describe("removeProjectLink", () => {
  it("returns true and deletes the file when it exists", () => {
    vi.mocked(existsSync).mockReturnValue(true);

    const result = removeProjectLink(cwd);

    expect(result).toBe(true);
    expect(unlinkSync).toHaveBeenCalledWith(expect.stringContaining(".pgbeam/project.json"));
  });

  it("returns false when no file exists", () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const result = removeProjectLink(cwd);

    expect(result).toBe(false);
    expect(unlinkSync).not.toHaveBeenCalled();
  });
});
