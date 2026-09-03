import type { ApiClient } from "pgbeam";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("consola", () => ({
  consola: {
    log: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockResolveAuthState = vi.fn();
vi.mock("../lib/client.js", () => ({
  resolveAuthState: (...a: unknown[]) => mockResolveAuthState(...a),
  apiBaseUrl: () => "https://api.test",
}));

vi.mock("../lib/orgs.js", () => ({
  errorStatus: (err: unknown) =>
    err && typeof err === "object" && "status" in err
      ? ((err as { status: number }).status ?? null)
      : null,
  fetchOrganizations: vi.fn(),
}));

const mockLoadProjectLink = vi.fn();
vi.mock("../lib/project.js", () => ({
  loadProjectLink: (...a: unknown[]) => mockLoadProjectLink(...a),
}));

vi.mock("./auth/status.js", () => ({
  maskKey: (token: string) => `${token.slice(0, 4)}...`,
  default: {},
}));

import { outputJson } from "../lib/output.js";

vi.mock("../lib/output.js", () => ({
  outputJson: vi.fn(),
}));

import type { GlobalArgs } from "../lib/flags.js";
import { type DoctorDeps, renderReport, runDoctor } from "./doctor.js";

interface FakeClientParts {
  getHealth?: () => Promise<{ status: string; version: string }>;
  getProject?: () => Promise<Record<string, unknown>>;
  listDatabases?: () => Promise<{ databases: Record<string, unknown>[] }>;
  getPolicyProfile?: () => Promise<Record<string, unknown>>;
}

function fakeClient(parts: FakeClientParts): ApiClient {
  return {
    platform: {
      getHealth: parts.getHealth ?? (() => Promise.resolve({ status: "ok", version: "1" })),
    },
    projects: { getProject: parts.getProject ?? (() => Promise.reject(new Error("no project"))) },
    databases: {
      listDatabases: parts.listDatabases ?? (() => Promise.resolve({ databases: [] })),
    },
    policies: {
      getPolicyProfile: parts.getPolicyProfile ?? (() => Promise.reject(new Error("no policy"))),
    },
  } as unknown as ApiClient;
}

function makeDeps(overrides: Partial<DoctorDeps> & { client?: ApiClient } = {}): DoctorDeps {
  const client = overrides.client ?? fakeClient({});
  return {
    makeClient: overrides.makeClient ?? (() => client),
    fetchOrganizations: overrides.fetchOrganizations ?? vi.fn().mockResolvedValue([]),
    probeTcp: overrides.probeTcp ?? vi.fn().mockResolvedValue({ ok: true, ms: 5 }),
    probeMcp: overrides.probeMcp ?? vi.fn().mockResolvedValue({ reachable: true, status: 401 }),
    baseUrl: overrides.baseUrl ?? "https://api.test",
  };
}

function args(overrides: Record<string, unknown> = {}): GlobalArgs {
  return { json: false, "no-color": false, debug: false, ...overrides } as GlobalArgs;
}

function byId(results: Awaited<ReturnType<typeof runDoctor>>, id: string) {
  const r = results.find((x) => x.id === id);
  if (!r) throw new Error(`no check with id ${id}`);
  return r;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.PGBEAM_MCP_TOKEN;
  mockLoadProjectLink.mockReturnValue(null);
});

afterEach(() => {
  process.exitCode = undefined;
});

describe("runDoctor", () => {
  it("passes every check on a fully healthy setup", async () => {
    mockResolveAuthState.mockReturnValue({
      token: "pbu_1234567890",
      source: "profile",
      orgId: "org_1",
      method: "api-key",
    });
    const client = fakeClient({
      getHealth: () => Promise.resolve({ status: "ok", version: "1.0.0" }),
      getProject: () =>
        Promise.resolve({
          id: "prj_1",
          name: "Acme",
          status: "active",
          proxy_host: "acme.proxy.pgbeam.app",
          default_policy_profile_id: "pol_1",
        }),
      listDatabases: () =>
        Promise.resolve({ databases: [{ host: "db.internal", port: 5432, ssl_mode: "require" }] }),
      getPolicyProfile: () =>
        Promise.resolve({
          name: "read-only",
          access_mode: "read_only",
          table_allowlist: ["users"],
          table_denylist: [],
          masking_rules: [{ table: "users", column: "email", kind: "redact" }],
          budget_queries_per_hour: 1000,
        }),
    });
    const deps = makeDeps({
      client,
      fetchOrganizations: vi.fn().mockResolvedValue([{ id: "org_1", name: "Acme", slug: "acme" }]),
      probeMcp: vi.fn().mockResolvedValue({
        reachable: true,
        status: 200,
        tools: [
          "briefing",
          "query",
          "validate_sql",
          "list_tables",
          "describe_table",
          "explain",
          "schema_catalog",
          "my_permissions",
        ],
      }),
    });

    const results = await runDoctor(args({ project: "prj_1", "mcp-token": "pba_x" }), deps);

    for (const r of results) {
      expect(r.status, `${r.id} should pass`).toBe("pass");
    }
  });

  it("fails when no credentials are present", async () => {
    mockResolveAuthState.mockReturnValue({
      token: null,
      source: "none",
      orgId: null,
      method: null,
    });

    const results = await runDoctor(args(), makeDeps());

    expect(byId(results, "credentials").status).toBe("fail");
    expect(byId(results, "token").status).toBe("skip");
    expect(byId(results, "project").status).toBe("warn");
    // Where a key comes from, not just what to run. A first run has neither,
    // and the long description that explains it is never rendered by --help.
    expect(byId(results, "credentials").remedy).toContain("dash.pgbeam.com");
  });

  it("fails the token check on a 401", async () => {
    mockResolveAuthState.mockReturnValue({
      token: "pbu_x",
      source: "env",
      orgId: null,
      method: "api-key",
    });
    const deps = makeDeps({
      fetchOrganizations: vi.fn().mockRejectedValue({ status: 401, message: "unauthorized" }),
    });

    const results = await runDoctor(args(), deps);

    expect(byId(results, "token").status).toBe("fail");
    expect(byId(results, "token").remedy).toContain("auth login");
  });

  it("fails the project check on a 404", async () => {
    mockResolveAuthState.mockReturnValue({
      token: "pbu_x",
      source: "profile",
      orgId: "org_1",
      method: "api-key",
    });
    const client = fakeClient({ getProject: () => Promise.reject({ status: 404 }) });
    const deps = makeDeps({
      client,
      fetchOrganizations: vi.fn().mockResolvedValue([{ id: "org_1", name: "Acme", slug: "acme" }]),
    });

    const results = await runDoctor(args({ project: "prj_missing" }), deps);

    expect(byId(results, "project").status).toBe("fail");
    expect(byId(results, "project").detail).toContain("not found");
  });

  it("degrades to warnings when everything is offline", async () => {
    mockResolveAuthState.mockReturnValue({
      token: "pbu_x",
      source: "profile",
      orgId: "org_1",
      method: "api-key",
    });
    const client = fakeClient({
      getHealth: () => Promise.reject(new TypeError("fetch failed")),
      getProject: () => Promise.reject(new TypeError("fetch failed")),
    });
    const deps = makeDeps({
      client,
      fetchOrganizations: vi.fn().mockRejectedValue(new TypeError("fetch failed")),
      probeTcp: vi.fn().mockResolvedValue({ ok: false, ms: 0, error: "ECONNREFUSED" }),
      probeMcp: vi.fn().mockResolvedValue({ reachable: false, error: "timed out" }),
    });

    const results = await runDoctor(args({ project: "prj_1" }), deps);

    // Credentials are present, so no check should hard-fail offline.
    expect(results.some((r) => r.status === "fail")).toBe(false);
    expect(byId(results, "api").status).toBe("warn");
    expect(byId(results, "token").status).toBe("warn");
  });

  it("warns when the MCP endpoint is missing expected tools", async () => {
    mockResolveAuthState.mockReturnValue({
      token: "pbu_x",
      source: "profile",
      orgId: "org_1",
      method: "api-key",
    });
    const client = fakeClient({
      getProject: () =>
        Promise.resolve({
          id: "prj_1",
          name: "Acme",
          status: "active",
          proxy_host: "acme.proxy.pgbeam.app",
        }),
    });
    const deps = makeDeps({
      client,
      fetchOrganizations: vi.fn().mockResolvedValue([{ id: "org_1", name: "Acme", slug: "acme" }]),
      probeMcp: vi.fn().mockResolvedValue({ reachable: true, status: 200, tools: ["query"] }),
    });

    const results = await runDoctor(args({ project: "prj_1", "mcp-token": "pba_x" }), deps);

    expect(byId(results, "mcp").status).toBe("warn");
    expect(byId(results, "mcp").detail).toContain("missing expected tools");
  });

  it("reads the MCP token from PGBEAM_MCP_TOKEN", async () => {
    process.env.PGBEAM_MCP_TOKEN = "pba_env";
    mockResolveAuthState.mockReturnValue({
      token: "pbu_x",
      source: "profile",
      orgId: "org_1",
      method: "api-key",
    });
    const client = fakeClient({
      getProject: () =>
        Promise.resolve({
          id: "prj_1",
          name: "Acme",
          status: "active",
          proxy_host: "h.pgbeam.app",
        }),
    });
    const probeMcp = vi.fn().mockResolvedValue({ reachable: true, status: 200, tools: [] });
    const deps = makeDeps({
      client,
      fetchOrganizations: vi.fn().mockResolvedValue([{ id: "org_1", name: "Acme", slug: "acme" }]),
      probeMcp,
    });

    await runDoctor(args({ project: "prj_1" }), deps);

    expect(probeMcp).toHaveBeenCalledWith("https://h.pgbeam.app/mcp", "pba_env");
  });
});

describe("renderReport", () => {
  it("emits a json envelope with ok=false when a check fails", () => {
    renderReport(
      [
        { id: "cli", title: "CLI", status: "pass", detail: "pgbeam 1.0.0." },
        {
          id: "credentials",
          title: "Credentials",
          status: "fail",
          detail: "none",
          remedy: "login",
        },
      ],
      true,
    );

    expect(outputJson).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(outputJson).mock.calls[0][0] as {
      ok: boolean;
      summary: { fail: number };
      checks: unknown[];
    };
    expect(payload.ok).toBe(false);
    expect(payload.summary.fail).toBe(1);
    expect(payload.checks).toHaveLength(2);
  });
});
