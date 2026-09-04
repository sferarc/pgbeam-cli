import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks, must come before imports
// ---------------------------------------------------------------------------
vi.mock("pgbeam", async (importOriginal) => {
  // Keep the real ApiError so rawRequest failures can be asserted on; only the
  // client construction is mocked.
  const actual = await importOriginal<typeof import("pgbeam")>();
  class MockPgBeamClient {
    api: Record<string, unknown>;
    constructor() {
      this.api = { mocked: true };
    }
  }
  return { ApiError: actual.ApiError, PgBeamClient: MockPgBeamClient };
});

vi.mock("./config.js", () => ({
  getCurrentProfile: vi.fn(),
  getProfile: vi.fn(),
}));

vi.mock("./project.js", () => ({
  loadProjectLink: vi.fn(),
}));

import { ApiError } from "pgbeam";
import { rawRequest, requireOrg, requireProject, resolveContext } from "./client";
import { getCurrentProfile, getProfile } from "./config.js";
import { loadProjectLink } from "./project.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const defaultArgs = {
  json: false,
  "no-color": false,
  debug: false,
} as const;

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
  // Clean up env vars
  delete process.env.PGBEAM_TOKEN;
  delete process.env.PGBEAM_PROFILE;
  delete process.env.PGBEAM_API_URL;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// resolveContext, token resolution
// ---------------------------------------------------------------------------
describe("resolveContext", () => {
  describe("token resolution priority", () => {
    it("throws when not authenticated at all", () => {
      vi.mocked(getCurrentProfile).mockReturnValue(null);

      expect(() => resolveContext(defaultArgs)).toThrow("Not authenticated");
    });

    it("uses --token flag as highest priority", () => {
      const ctx = resolveContext({ ...defaultArgs, token: "flag-token" });

      expect(ctx.client).toBeDefined();
    });

    it("uses --profile flag when --token is not set", () => {
      vi.mocked(getProfile).mockReturnValue({
        method: "api-key",
        token: "profile-tok",
      });

      const ctx = resolveContext({ ...defaultArgs, profile: "myprofile" });

      expect(ctx.client).toBeDefined();
      expect(getProfile).toHaveBeenCalledWith("myprofile");
    });

    it("throws when --profile references a missing profile", () => {
      vi.mocked(getProfile).mockReturnValue(null);

      expect(() => resolveContext({ ...defaultArgs, profile: "ghost" })).toThrow(
        'Profile "ghost" not found',
      );
    });

    it("uses PGBEAM_TOKEN env var when no flag is set", () => {
      process.env.PGBEAM_TOKEN = "env-token";

      const ctx = resolveContext(defaultArgs);

      expect(ctx.client).toBeDefined();
    });

    it("uses PGBEAM_PROFILE env var when no PGBEAM_TOKEN", () => {
      process.env.PGBEAM_PROFILE = "env-profile";
      vi.mocked(getProfile).mockReturnValue({
        method: "api-key",
        token: "env-profile-tok",
      });

      const ctx = resolveContext(defaultArgs);

      expect(ctx.client).toBeDefined();
      expect(getProfile).toHaveBeenCalledWith("env-profile");
    });

    it("throws when PGBEAM_PROFILE env var references a missing profile", () => {
      process.env.PGBEAM_PROFILE = "missing-env";
      vi.mocked(getProfile).mockReturnValue(null);

      expect(() => resolveContext(defaultArgs)).toThrow(
        'Profile "missing-env" (from PGBEAM_PROFILE) not found',
      );
    });

    it("falls back to current profile when no flags or env vars", () => {
      vi.mocked(getCurrentProfile).mockReturnValue({
        method: "api-key",
        token: "current-tok",
      });

      const ctx = resolveContext(defaultArgs);

      expect(ctx.client).toBeDefined();
    });
  });

  describe("orgId resolution", () => {
    it("uses --org flag when provided", () => {
      const ctx = resolveContext({
        ...defaultArgs,
        token: "tok",
        org: "org-flag",
      });

      expect(ctx.orgId).toBe("org-flag");
    });

    it("uses profile orgId when --profile flag is set", () => {
      vi.mocked(getProfile).mockReturnValue({
        method: "oauth",
        token: "tok",
        orgId: "org-from-profile",
        refreshToken: "ref",
        expiresAt: "2099-01-01",
        email: "a@b.com",
      });

      const ctx = resolveContext({
        ...defaultArgs,
        profile: "myprofile",
      });

      expect(ctx.orgId).toBe("org-from-profile");
    });

    it("uses current profile orgId as fallback", () => {
      vi.mocked(getCurrentProfile).mockReturnValue({
        method: "oauth",
        token: "tok",
        orgId: "org-current",
        refreshToken: "ref",
        expiresAt: "2099-01-01",
        email: "a@b.com",
      });

      const ctx = resolveContext({ ...defaultArgs, token: "tok" });

      expect(ctx.orgId).toBe("org-current");
    });

    it("returns null orgId when no org is available", () => {
      vi.mocked(getCurrentProfile).mockReturnValue(null);

      const ctx = resolveContext({ ...defaultArgs, token: "tok" });

      expect(ctx.orgId).toBeNull();
    });
  });

  describe("projectId resolution", () => {
    it("uses --project flag when provided", () => {
      const ctx = resolveContext({
        ...defaultArgs,
        token: "tok",
        project: "proj-flag",
      });

      expect(ctx.projectId).toBe("proj-flag");
    });

    it("uses .pgbeam/project.json link as fallback", () => {
      vi.mocked(loadProjectLink).mockReturnValue({
        projectId: "proj-linked",
        orgId: "org-linked",
      });

      const ctx = resolveContext({ ...defaultArgs, token: "tok" });

      expect(ctx.projectId).toBe("proj-linked");
    });

    it("returns null projectId when no project is linked", () => {
      vi.mocked(loadProjectLink).mockReturnValue(null);

      const ctx = resolveContext({ ...defaultArgs, token: "tok" });

      expect(ctx.projectId).toBeNull();
    });
  });

  describe("base URL", () => {
    it("uses PGBEAM_API_URL env var when set", () => {
      process.env.PGBEAM_API_URL = "https://custom-api.example.com";

      // This succeeds if the client is created without error
      const ctx = resolveContext({ ...defaultArgs, token: "tok" });
      expect(ctx.client).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// requireProject
// ---------------------------------------------------------------------------
describe("requireProject", () => {
  it("returns the project ID when present", () => {
    const ctx = {
      client: {} as ReturnType<typeof resolveContext>["client"],
      orgId: "org-1",
      projectId: "proj-1",
    };

    expect(requireProject(ctx)).toBe("proj-1");
  });

  it("throws when projectId is null", () => {
    const ctx = {
      client: {} as ReturnType<typeof resolveContext>["client"],
      orgId: "org-1",
      projectId: null,
    };

    expect(() => requireProject(ctx)).toThrow("No project linked");
  });
});

// ---------------------------------------------------------------------------
// requireOrg
// ---------------------------------------------------------------------------
describe("requireOrg", () => {
  it("returns the org ID when present", () => {
    const ctx = {
      client: {} as ReturnType<typeof resolveContext>["client"],
      orgId: "org-1",
      projectId: null,
    };

    expect(requireOrg(ctx)).toBe("org-1");
  });

  it("throws when orgId is null", () => {
    const ctx = {
      client: {} as ReturnType<typeof resolveContext>["client"],
      orgId: null,
      projectId: null,
    };

    expect(() => requireOrg(ctx)).toThrow("No organization set");
  });
});

// ---------------------------------------------------------------------------
// rawRequest
// ---------------------------------------------------------------------------
describe("rawRequest", () => {
  function jsonResponse(body: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response;
  }

  it("throws when not authenticated", async () => {
    vi.mocked(getCurrentProfile).mockReturnValue(null);

    await expect(rawRequest(defaultArgs, "GET", "/v1/health")).rejects.toThrow("Not authenticated");
  });

  it("makes a GET request with auth header", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ status: "ok" }));

    const result = await rawRequest({ ...defaultArgs, token: "tok" }, "GET", "/v1/health");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/v1/health");
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(result).toEqual({ status: "ok" });
  });

  it("substitutes path parameters", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ id: "proj-1" }));

    await rawRequest({ ...defaultArgs, token: "tok" }, "GET", "/v1/projects/{project_id}", {
      pathParams: { project_id: "proj-1" },
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/v1/projects/proj-1");
    expect(url).not.toContain("{project_id}");
  });

  it("appends query parameters", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ items: [] }));

    await rawRequest({ ...defaultArgs, token: "tok" }, "GET", "/v1/projects", {
      queryParams: { org_id: "org-1" },
    });

    const [url] = mockFetch.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.searchParams.get("org_id")).toBe("org-1");
  });

  it("sends JSON body for POST requests", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ id: "new" }, 201));

    const body = { name: "test" };
    await rawRequest({ ...defaultArgs, token: "tok" }, "POST", "/v1/projects", { body });

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify(body));
  });

  it("returns undefined for 204 responses", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 204,
      statusText: "No Content",
      headers: new Headers(),
      json: () => Promise.reject(new Error("no body")),
      text: () => Promise.resolve(""),
    } as unknown as Response);

    const result = await rawRequest(
      { ...defaultArgs, token: "tok" },
      "DELETE",
      "/v1/projects/{project_id}",
      { pathParams: { project_id: "proj-1" } },
    );

    expect(result).toBeUndefined();
  });

  it("returns text for non-JSON responses", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "text/plain" }),
      json: () => Promise.reject(new Error("not json")),
      text: () => Promise.resolve("plain text response"),
    } as unknown as Response);

    const result = await rawRequest({ ...defaultArgs, token: "tok" }, "GET", "/v1/something");

    expect(result).toBe("plain text response");
  });

  it("throws an ApiError carrying status and body, with the message from the body", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.resolve({ message: "Project not found" }),
      text: () => Promise.resolve('{"message":"Project not found"}'),
    } as unknown as Response);

    const promise = rawRequest({ ...defaultArgs, token: "tok" }, "GET", "/v1/projects/missing");
    await expect(promise).rejects.toThrow("Project not found");
    await promise.catch((err: unknown) => {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(404);
      expect(apiErr.body).toEqual({ message: "Project not found" });
    });
  });

  it("throws an ApiError with statusText when the error body is not JSON", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      headers: new Headers(),
      json: () => Promise.reject(new Error("not json")),
      text: () => Promise.resolve(""),
    } as unknown as Response);

    const promise = rawRequest({ ...defaultArgs, token: "tok" }, "GET", "/v1/health");
    await expect(promise).rejects.toThrow("Internal Server Error");
    await promise.catch((err: unknown) => {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(500);
    });
  });
});
