import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("consola", () => ({
  consola: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    log: vi.fn(),
  },
}));

vi.mock("../../lib/config.js", () => ({
  loadAuthConfig: vi.fn(),
  getCurrentProfile: vi.fn(),
  getProfile: vi.fn(),
}));

const mockResolveAuthState = vi.fn();
vi.mock("../../lib/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/client.js")>()),
  resolveAuthState: (...args: unknown[]) => mockResolveAuthState(...args),
}));

const mockFetchOrganizations = vi.fn();
vi.mock("../../lib/orgs.js", () => ({
  errorStatus: (err: unknown) =>
    err && typeof err === "object" && "status" in err
      ? ((err as { status: number }).status ?? null)
      : null,
  fetchOrganizations: (...args: unknown[]) => mockFetchOrganizations(...args),
}));

vi.mock("../../lib/output.js", () => ({
  output: vi.fn((data, json, tableFn) => {
    void data;
    if (json) return;
    if (tableFn) tableFn();
  }),
}));

import { consola } from "consola";
import { getCurrentProfile, loadAuthConfig } from "../../lib/config.js";
import { output } from "../../lib/output.js";
import statusCommand, { maskKey } from "./status.js";

const { resolveAuthState: realResolveAuthState } =
  await vi.importActual<typeof import("../../lib/client.js")>("../../lib/client.js");

const run = statusCommand.run;
if (!run) throw new Error("command.run is not defined");

function setAuthState(overrides: Record<string, unknown> = {}) {
  mockResolveAuthState.mockReturnValue({
    token: "pbu_1234567890abcdef",
    source: "profile",
    orgId: null,
    method: "api-key",
    ...overrides,
  });
}

describe("maskKey", () => {
  it("keeps the key prefix and last 4 characters", () => {
    expect(maskKey("pbu_1234567890abcdef")).toBe("pbu_...cdef");
    expect(maskKey("pbo_1234567890abcdef")).toBe("pbo_...cdef");
  });

  it("never reveals a short token beyond its first characters", () => {
    expect(maskKey("shorttok")).toBe("shor...");
  });

  it("falls back to the first 4 characters when there is no prefix", () => {
    expect(maskKey("1234567890abcdefgh")).toBe("1234...efgh");
  });
});

describe("auth status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    // Isolate from ambient credentials so "not authenticated" is deterministic.
    for (const name of ["PGBEAM_API_KEY", "PGBEAM_TOKEN", "PGBEAM_API_TOKEN", "PGBEAM_PROFILE"]) {
      delete process.env[name];
    }
    vi.mocked(loadAuthConfig).mockReturnValue({ currentProfile: "", profiles: {} });
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it("shows not authenticated when no credential resolves", async () => {
    setAuthState({ token: null, source: "none", method: null });

    await run({ args: { json: false, "no-color": false, debug: false } } as never);

    expect(consola.warn).toHaveBeenCalledWith(
      "Not authenticated. Run `pgbeam auth login` to get started.",
    );
    expect(process.exitCode).toBe(1);
    expect(mockFetchOrganizations).not.toHaveBeenCalled();
  });

  it("outputs JSON when not authenticated and --json is set", async () => {
    setAuthState({ token: null, source: "none", method: null });

    await run({ args: { json: true, "no-color": false, debug: false } } as never);

    expect(output).toHaveBeenCalledWith({ authenticated: false }, true);
    expect(process.exitCode).toBe(1);
  });

  it("verifies the credential live and reports identity for a profile", async () => {
    setAuthState({ orgId: "org_123" });
    vi.mocked(loadAuthConfig).mockReturnValue({
      currentProfile: "default",
      profiles: {
        default: {
          method: "api-key",
          token: "pbu_1234567890abcdef",
          orgId: "org_123",
          email: "user@example.com",
        },
      },
    });
    mockFetchOrganizations.mockResolvedValue([{ id: "org_123", name: "Acme", slug: "acme" }]);

    await run({ args: { json: false, "no-color": false, debug: false } } as never);

    expect(mockFetchOrganizations).toHaveBeenCalledWith("pbu_1234567890abcdef");
    expect(output).toHaveBeenCalledWith(
      expect.objectContaining({
        authenticated: true,
        verified: true,
        profile: "default",
        method: "api-key",
        key: "pbu_...cdef",
        orgId: "org_123",
        orgName: "Acme",
        email: "user@example.com",
      }),
      false,
      expect.any(Function),
    );
    expect(process.exitCode).toBeUndefined();

    const logCalls = vi.mocked(consola.log).mock.calls.map((c) => String(c[0]));
    expect(logCalls.some((c) => c.includes("default"))).toBe(true);
    expect(logCalls.some((c) => c.includes("pbu_...cdef"))).toBe(true);
    expect(logCalls.some((c) => c.includes("user@example.com"))).toBe(true);
    expect(logCalls.some((c) => c.includes("Acme (org_123)"))).toBe(true);
    expect(logCalls.some((c) => c.includes("Verified: yes"))).toBe(true);
  });

  it("reports a rejected credential (401) and exits non-zero", async () => {
    setAuthState();
    vi.mocked(loadAuthConfig).mockReturnValue({
      currentProfile: "default",
      profiles: {
        default: { method: "api-key", token: "pbu_1234567890abcdef" },
      },
    });
    mockFetchOrganizations.mockRejectedValue({ status: 401, message: "unauthorized" });

    await run({ args: { json: false, "no-color": false, debug: false } } as never);

    expect(output).toHaveBeenCalledWith(
      expect.objectContaining({ authenticated: false, verified: false }),
      false,
      expect.any(Function),
    );
    expect(consola.warn).toHaveBeenCalledWith(expect.stringContaining("rejected by the API (401)"));
    expect(process.exitCode).toBe(1);
  });

  it("degrades gracefully when the API is unreachable", async () => {
    setAuthState({ orgId: "org_456" });
    vi.mocked(loadAuthConfig).mockReturnValue({
      currentProfile: "ci",
      profiles: {
        ci: { method: "api-key", token: "pbu_1234567890abcdef", orgId: "org_456" },
      },
    });
    mockFetchOrganizations.mockRejectedValue(new TypeError("fetch failed"));

    await run({ args: { json: false, "no-color": false, debug: false } } as never);

    expect(output).toHaveBeenCalledWith(
      expect.objectContaining({
        authenticated: true,
        verified: null,
        orgId: "org_456",
        orgName: null,
      }),
      false,
      expect.any(Function),
    );
    expect(process.exitCode).toBeUndefined();

    const logCalls = vi.mocked(consola.log).mock.calls.map((c) => String(c[0]));
    expect(logCalls.some((c) => c.includes("API unreachable"))).toBe(true);
    expect(logCalls.some((c) => c.includes("org_456"))).toBe(true);
  });

  it("reports a flag/env credential with its source when no profile exists", async () => {
    setAuthState({ source: "env", token: "pbo_1234567890abcdef" });
    mockFetchOrganizations.mockResolvedValue([{ id: "org_9", name: "Solo", slug: "solo" }]);

    await run({ args: { json: false, "no-color": false, debug: false } } as never);

    expect(output).toHaveBeenCalledWith(
      expect.objectContaining({
        authenticated: true,
        verified: true,
        profile: null,
        source: "env",
        key: "pbo_...cdef",
        email: null,
      }),
      false,
      expect.any(Function),
    );

    const logCalls = vi.mocked(consola.log).mock.calls.map((c) => String(c[0]));
    expect(logCalls.some((c) => c.includes("PGBEAM_API_KEY env"))).toBe(true);
  });

  it("passes json=true through to output", async () => {
    setAuthState();
    vi.mocked(loadAuthConfig).mockReturnValue({
      currentProfile: "default",
      profiles: {
        default: { method: "api-key", token: "pbu_1234567890abcdef" },
      },
    });
    mockFetchOrganizations.mockResolvedValue([]);

    await run({ args: { json: true, "no-color": false, debug: false } } as never);

    expect(output).toHaveBeenCalledWith(
      expect.objectContaining({ authenticated: true, verified: true }),
      true,
      expect.any(Function),
    );
  });
  describe("org resolution with an env credential", () => {
    beforeEach(() => {
      mockResolveAuthState.mockImplementation(realResolveAuthState);
      process.env.PGBEAM_API_KEY = "pbo_1234567890abcdef";
    });

    afterEach(() => {
      delete process.env.PGBEAM_API_KEY;
    });

    it("shows the stored profile's org with its source and warns", async () => {
      vi.mocked(getCurrentProfile).mockReturnValue({
        method: "api-key",
        token: "pbu_other",
        orgId: "org_A",
      });
      mockFetchOrganizations.mockResolvedValue([{ id: "org_A", name: "Laptop", slug: "laptop" }]);

      await run({ args: { json: false, "no-color": false, debug: false } } as never);

      expect(output).toHaveBeenCalledWith(
        expect.objectContaining({ source: "env", orgId: "org_A", orgSource: "profile" }),
        false,
        expect.any(Function),
      );
      const logCalls = vi.mocked(consola.log).mock.calls.map((c) => String(c[0]));
      expect(logCalls).toContain("Org:      Laptop (org_A), from saved profile");
      expect(consola.warn).toHaveBeenCalledWith(expect.stringContaining("Pass --org"));
    });

    it("uses --org over the stored profile without warning", async () => {
      vi.mocked(getCurrentProfile).mockReturnValue({
        method: "api-key",
        token: "pbu_other",
        orgId: "org_A",
      });
      mockFetchOrganizations.mockResolvedValue([{ id: "org_B", name: "CI", slug: "ci" }]);

      await run({ args: { json: true, "no-color": false, debug: false, org: "org_B" } } as never);

      expect(output).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: "org_B", orgName: "CI", orgSource: "flag" }),
        true,
        expect.any(Function),
      );
      expect(consola.warn).not.toHaveBeenCalled();
    });

    it("reports no org when no profile exists", async () => {
      vi.mocked(getCurrentProfile).mockReturnValue(null);
      mockFetchOrganizations.mockResolvedValue([]);

      await run({ args: { json: true, "no-color": false, debug: false } } as never);

      expect(output).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: null, orgSource: "none" }),
        true,
        expect.any(Function),
      );
      expect(consola.warn).not.toHaveBeenCalled();
    });
  });
});
