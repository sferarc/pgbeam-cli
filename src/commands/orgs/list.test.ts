import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("consola", () => ({
  consola: {
    info: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../../lib/config.js", () => ({
  listProfiles: vi.fn(),
}));

vi.mock("../../lib/client.js", () => ({
  resolveAuthState: vi.fn(),
  resolveContext: vi.fn(),
}));

vi.mock("../../lib/errors.js", () => ({
  runCommand: vi.fn(async (fn: () => Promise<void>) => fn()),
}));

vi.mock("../../lib/orgs.js", () => ({
  errorStatus: (err: unknown) =>
    err && typeof err === "object" && "status" in err
      ? ((err as { status: number }).status ?? null)
      : null,
}));

vi.mock("../../lib/output.js", () => ({
  output: vi.fn((data: unknown, json: boolean, tableFn?: () => void) => {
    void data;
    if (!json && tableFn) tableFn();
  }),
  outputTable: vi.fn(),
}));

import { consola } from "consola";
import { resolveAuthState, resolveContext } from "../../lib/client.js";
import { listProfiles } from "../../lib/config.js";
import { outputTable } from "../../lib/output.js";
import listCommand from "./list.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mockListOrganizations = vi.fn();

function buildArgs(overrides: Record<string, unknown> = {}) {
  return {
    json: false,
    "no-color": false,
    debug: false,
    ...overrides,
  };
}

function setupUnauthenticated() {
  vi.mocked(resolveAuthState).mockReturnValue({
    token: null,
    source: "none",
    orgId: null,
    method: null,
  });
}

function setupAuthenticated(orgId: string | null = "org-1") {
  vi.mocked(resolveAuthState).mockReturnValue({
    token: "tok-1",
    source: "profile",
    orgId,
    method: "api-key",
  });
  vi.mocked(resolveContext).mockReturnValue({
    client: { account: { listOrganizations: mockListOrganizations } },
    orgId,
    projectId: null,
  } as never);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
});

describe("orgs list (live API)", () => {
  it("lists organizations from the API with the active org marked", async () => {
    setupAuthenticated("org-2");
    mockListOrganizations.mockResolvedValue({
      organizations: [
        { id: "org-1", name: "Acme", slug: "acme", role: "owner" },
        { id: "org-2", name: "Globex", slug: "globex" },
      ],
    });

    await listCommand.run?.({ args: buildArgs() } as never);

    expect(outputTable).toHaveBeenCalledWith(
      [
        { active: "", id: "org-1", name: "Acme", slug: "acme", role: "owner" },
        { active: "*", id: "org-2", name: "Globex", slug: "globex", role: "" },
      ],
      [
        { key: "active", label: "" },
        { key: "id", label: "ID" },
        { key: "name", label: "Name" },
        { key: "slug", label: "Slug" },
        { key: "role", label: "Role" },
      ],
    );
    expect(listProfiles).not.toHaveBeenCalled();
  });

  it("shows a dashboard hint when the credential sees no organizations", async () => {
    setupAuthenticated(null);
    mockListOrganizations.mockResolvedValue({ organizations: [] });

    await listCommand.run?.({ args: buildArgs() } as never);

    expect(consola.info).toHaveBeenCalledWith(
      expect.stringContaining("No organizations are visible"),
    );
  });

  it("rethrows HTTP errors (e.g. 401) instead of hiding them in the fallback", async () => {
    setupAuthenticated();
    mockListOrganizations.mockRejectedValue({ status: 401, message: "unauthorized" });

    await expect(listCommand.run?.({ args: buildArgs() } as never)).rejects.toMatchObject({
      status: 401,
    });
  });

  it("falls back to saved profiles when the API is unreachable", async () => {
    setupAuthenticated();
    mockListOrganizations.mockRejectedValue(new TypeError("fetch failed"));
    vi.mocked(listProfiles).mockReturnValue([
      {
        name: "default",
        profile: { method: "api-key" as const, token: "tok-1", orgId: "org-1" },
        active: true,
      },
    ]);

    await listCommand.run?.({ args: buildArgs() } as never);

    expect(consola.warn).toHaveBeenCalledWith(expect.stringContaining("Could not reach the API"));
    expect(outputTable).toHaveBeenCalledWith(
      [{ profile: "default", orgId: "org-1", active: "*" }],
      [
        { key: "active", label: "" },
        { key: "profile", label: "Profile" },
        { key: "orgId", label: "Org ID" },
      ],
    );
  });
});

describe("orgs list (offline profile fallback)", () => {
  beforeEach(() => {
    setupUnauthenticated();
  });

  it("shows info message when no orgs are configured", async () => {
    vi.mocked(listProfiles).mockReturnValue([]);

    await listCommand.run?.({ args: buildArgs() } as never);

    expect(consola.info).toHaveBeenCalledWith(
      "No organizations configured. Set an org with `pgbeam orgs switch`.",
    );
  });

  it("shows info message when profiles exist but none have an orgId", async () => {
    vi.mocked(listProfiles).mockReturnValue([
      {
        name: "default",
        profile: { method: "api-key" as const, token: "tok-1" },
        active: true,
      },
    ]);

    await listCommand.run?.({ args: buildArgs() } as never);

    expect(consola.info).toHaveBeenCalledWith(
      expect.stringContaining("No organizations configured"),
    );
  });

  it("renders a table with org data from profiles", async () => {
    vi.mocked(listProfiles).mockReturnValue([
      {
        name: "default",
        profile: { method: "oauth" as const, token: "tok-1", orgId: "org-1" },
        active: true,
      },
      {
        name: "ci",
        profile: { method: "api-key" as const, token: "tok-2", orgId: "org-2" },
        active: false,
      },
    ]);

    await listCommand.run?.({ args: buildArgs() } as never);

    expect(outputTable).toHaveBeenCalledWith(
      [
        { profile: "default", orgId: "org-1", active: "*" },
        { profile: "ci", orgId: "org-2", active: "" },
      ],
      [
        { key: "active", label: "" },
        { key: "profile", label: "Profile" },
        { key: "orgId", label: "Org ID" },
      ],
    );
  });

  it("filters out profiles without orgId", async () => {
    vi.mocked(listProfiles).mockReturnValue([
      {
        name: "default",
        profile: { method: "oauth" as const, token: "tok-1", orgId: "org-1" },
        active: true,
      },
      {
        name: "no-org",
        profile: { method: "api-key" as const, token: "tok-2" },
        active: false,
      },
    ]);

    await listCommand.run?.({ args: buildArgs() } as never);

    expect(outputTable).toHaveBeenCalledWith(
      [{ profile: "default", orgId: "org-1", active: "*" }],
      expect.any(Array),
    );
  });
});
