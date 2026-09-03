import { afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Import the module fresh so the top-level `VERSION` is re-evaluated. */
async function importConstants() {
  return import("./constants") as Promise<{
    VERSION: string;
    normalizeVersion: (version: string) => string;
  }>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe("VERSION", () => {
  it("reads version from package.json when __PGBEAM_VERSION__ is not defined", async () => {
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: "1.2.3" }));

    const { VERSION } = await importConstants();

    expect(VERSION).toBe("1.2.3");
    expect(readFileSync).toHaveBeenCalledWith(expect.stringContaining("package.json"), "utf-8");
  });

  it("returns fallback version when readFileSync throws", async () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const { VERSION } = await importConstants();

    expect(VERSION).toBe("0.0.0-unknown");
  });

  it("returns fallback version when package.json has invalid JSON", async () => {
    vi.mocked(readFileSync).mockReturnValue("not valid json");

    const { VERSION } = await importConstants();

    expect(VERSION).toBe("0.0.0-unknown");
  });

  it("has no wrapping quotes", async () => {
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: "0.2.0" }));

    const { VERSION } = await importConstants();

    expect(VERSION).toBe("0.2.0");
    expect(VERSION).not.toContain('"');
    expect(VERSION).not.toContain("'");
  });
});

describe("normalizeVersion", () => {
  it("strips wrapping double quotes injected by a misconfigured build define", async () => {
    const { normalizeVersion } = await importConstants();
    expect(normalizeVersion('"0.2.0"')).toBe("0.2.0");
  });

  it("strips wrapping single quotes", async () => {
    const { normalizeVersion } = await importConstants();
    expect(normalizeVersion("'0.2.0'")).toBe("0.2.0");
  });

  it("leaves an unquoted version untouched", async () => {
    const { normalizeVersion } = await importConstants();
    expect(normalizeVersion("0.2.0")).toBe("0.2.0");
  });
});
