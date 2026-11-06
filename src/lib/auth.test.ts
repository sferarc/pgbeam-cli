import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks, must come before imports
// ---------------------------------------------------------------------------
vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(),
  password: vi.fn(),
  select: vi.fn(),
}));

vi.mock("consola", () => ({
  consola: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const mockLoadAuthConfig = vi.fn();
vi.mock("./config.js", () => ({
  loadAuthConfig: () => mockLoadAuthConfig(),
  setProfile: vi.fn(),
  switchProfile: vi.fn(),
}));

const mockFetchOrganizations = vi.fn();
vi.mock("./orgs.js", () => ({
  ORG_ID_DASHBOARD_HINT:
    "You can copy your organization ID from the dashboard under Settings > Organization.",
  errorStatus: (err: unknown) =>
    err && typeof err === "object" && "status" in err
      ? ((err as { status: number }).status ?? null)
      : null,
  fetchOrganizations: (...args: unknown[]) => mockFetchOrganizations(...args),
}));

const mockReadStdin = vi.fn();
vi.mock("./stdin.js", () => ({
  readStdin: () => mockReadStdin(),
}));

const mockOutputJson = vi.fn();
vi.mock("./output.js", () => ({
  outputJson: (data: unknown) => mockOutputJson(data),
}));

import { input, password, select } from "@inquirer/prompts";
import { consola } from "consola";
import { loginWithApiKey, resolveLoginOrg } from "./auth";
import { setProfile, switchProfile } from "./config.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  mockLoadAuthConfig.mockReturnValue({ currentProfile: "", profiles: {} });
  // Prevent process.exit from actually exiting
  vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit");
  });
});

describe("resolveLoginOrg", () => {
  it("returns null for an empty org list", async () => {
    expect(await resolveLoginOrg([])).toBeNull();
    expect(select).not.toHaveBeenCalled();
  });

  it("auto-selects a single org without prompting", async () => {
    const org = { id: "org-1", name: "Acme", slug: "acme" };
    expect(await resolveLoginOrg([org])).toEqual(org);
    expect(select).not.toHaveBeenCalled();
  });

  it("prompts a pick among multiple orgs", async () => {
    const orgs = [
      { id: "org-1", name: "Acme", slug: "acme" },
      { id: "org-2", name: "Globex", slug: "globex" },
    ];
    vi.mocked(select).mockResolvedValue("org-2");

    expect(await resolveLoginOrg(orgs)).toEqual(orgs[1]);
    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({
        choices: [
          { name: "Acme (org-1)", value: "org-1" },
          { name: "Globex (org-2)", value: "org-2" },
        ],
      }),
    );
  });

  it("fails naming --org instead of prompting without a terminal", async () => {
    const orgs = [
      { id: "org-1", name: "Acme", slug: "acme" },
      { id: "org-2", name: "Globex", slug: "globex" },
    ];

    await expect(resolveLoginOrg(orgs, false)).rejects.toThrow(
      "Pass --org with one of: org-1 (Acme), org-2 (Globex).",
    );
    expect(select).not.toHaveBeenCalled();
  });
});

describe("loginWithApiKey", () => {
  it("validates the key, auto-selects a single org, and stores it in the profile", async () => {
    vi.mocked(password).mockResolvedValue("my-api-key");
    vi.mocked(input).mockResolvedValue("ci");
    mockFetchOrganizations.mockResolvedValue([{ id: "org-1", name: "Acme", slug: "acme" }]);

    await loginWithApiKey({ isTTY: true });

    expect(mockFetchOrganizations).toHaveBeenCalledWith("my-api-key");
    expect(setProfile).toHaveBeenCalledWith("ci", {
      method: "api-key",
      token: "my-api-key",
      orgId: "org-1",
    });
    expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("ci"));
    expect(consola.info).toHaveBeenCalledWith(expect.stringContaining("Acme (org-1)"));
  });

  it("prompts among multiple orgs and stores the chosen one", async () => {
    vi.mocked(password).mockResolvedValue("key-123");
    vi.mocked(input).mockResolvedValue("default");
    mockFetchOrganizations.mockResolvedValue([
      { id: "org-1", name: "Acme", slug: "acme" },
      { id: "org-2", name: "Globex", slug: "globex" },
    ]);
    vi.mocked(select).mockResolvedValue("org-2");

    await loginWithApiKey({ isTTY: true });

    expect(setProfile).toHaveBeenCalledWith("default", {
      method: "api-key",
      token: "key-123",
      orgId: "org-2",
    });
  });

  it("rejects the login on 401 without storing anything", async () => {
    vi.mocked(password).mockResolvedValue("bad-key");
    mockFetchOrganizations.mockRejectedValue({ status: 401, message: "unauthorized" });

    await expect(loginWithApiKey({ isTTY: true })).rejects.toThrow("process.exit");

    expect(setProfile).not.toHaveBeenCalled();
    expect(switchProfile).not.toHaveBeenCalled();
    expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("rejected (401)"));
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("stores the key unverified when the API is unreachable", async () => {
    vi.mocked(password).mockResolvedValue("offline-key");
    vi.mocked(input).mockResolvedValue("default");
    mockFetchOrganizations.mockRejectedValue(new TypeError("fetch failed"));

    await loginWithApiKey({ isTTY: true });

    expect(consola.warn).toHaveBeenCalledWith(expect.stringContaining("unverified"));
    expect(setProfile).toHaveBeenCalledWith("default", {
      method: "api-key",
      token: "offline-key",
    });
    expect(consola.info).toHaveBeenCalledWith(expect.stringContaining("pgbeam orgs switch"));
  });

  it("warns when the key sees no organizations", async () => {
    vi.mocked(password).mockResolvedValue("orphan-key");
    vi.mocked(input).mockResolvedValue("default");
    mockFetchOrganizations.mockResolvedValue([]);

    await loginWithApiKey({ isTTY: true });

    expect(setProfile).toHaveBeenCalledWith("default", {
      method: "api-key",
      token: "orphan-key",
    });
    expect(consola.warn).toHaveBeenCalledWith(expect.stringContaining("No organizations"));
  });

  it("uses the provided profile name without prompting", async () => {
    vi.mocked(password).mockResolvedValue("my-api-key");
    mockFetchOrganizations.mockResolvedValue([{ id: "org-1", name: "Acme", slug: "acme" }]);

    await loginWithApiKey({ profile: "custom-profile", isTTY: true });

    expect(input).not.toHaveBeenCalled();
    expect(setProfile).toHaveBeenCalledWith("custom-profile", {
      method: "api-key",
      token: "my-api-key",
      orgId: "org-1",
    });
  });

  it("exits with error when no API key is provided", async () => {
    vi.mocked(password).mockResolvedValue("");

    await expect(loginWithApiKey({ isTTY: true })).rejects.toThrow("process.exit");

    expect(consola.error).toHaveBeenCalledWith("No API key provided.");
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(mockFetchOrganizations).not.toHaveBeenCalled();
  });

  it("prompts for a profile name when none is given", async () => {
    vi.mocked(password).mockResolvedValue("key-123");
    vi.mocked(input).mockResolvedValue("default");
    mockFetchOrganizations.mockResolvedValue([{ id: "org-1", name: "Acme", slug: "acme" }]);

    await loginWithApiKey({ isTTY: true });

    expect(input).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Profile name:",
        default: "default",
      }),
    );
  });

  it("suggests the projects commands as the next step after resolving an org", async () => {
    vi.mocked(password).mockResolvedValue("tok");
    vi.mocked(input).mockResolvedValue("default");
    mockFetchOrganizations.mockResolvedValue([{ id: "org-1", name: "Acme", slug: "acme" }]);

    await loginWithApiKey({ isTTY: true });

    expect(consola.info).toHaveBeenCalledWith(expect.stringContaining("pgbeam projects list"));
  });
  it("makes the stored profile active and says which profile it replaced", async () => {
    mockLoadAuthConfig.mockReturnValue({ currentProfile: "default", profiles: {} });
    vi.mocked(password).mockResolvedValue("tok");
    mockFetchOrganizations.mockResolvedValue([{ id: "org-1", name: "Acme" }]);

    await loginWithApiKey({ profile: "staging", isTTY: true });

    expect(switchProfile).toHaveBeenCalledWith("staging");
    expect(consola.info).toHaveBeenCalledWith(
      'Switched active profile from "default" to "staging".',
    );
  });

  it("activates an unverified profile too", async () => {
    mockLoadAuthConfig.mockReturnValue({ currentProfile: "default", profiles: {} });
    vi.mocked(password).mockResolvedValue("offline-key");
    mockFetchOrganizations.mockRejectedValue(new TypeError("fetch failed"));

    await loginWithApiKey({ profile: "staging", isTTY: true });

    expect(switchProfile).toHaveBeenCalledWith("staging");
    expect(consola.info).toHaveBeenCalledWith(
      'Switched active profile from "default" to "staging".',
    );
  });

  it("prints no switch message when re-logging into the active profile", async () => {
    mockLoadAuthConfig.mockReturnValue({ currentProfile: "staging", profiles: {} });
    vi.mocked(password).mockResolvedValue("tok");
    mockFetchOrganizations.mockResolvedValue([{ id: "org-1", name: "Acme" }]);

    await loginWithApiKey({ profile: "staging", isTTY: true });

    expect(switchProfile).toHaveBeenCalledWith("staging");
    expect(consola.info).not.toHaveBeenCalledWith(
      expect.stringContaining("Switched active profile"),
    );
  });

  it("prints no switch message on the first login", async () => {
    vi.mocked(password).mockResolvedValue("tok");
    mockFetchOrganizations.mockResolvedValue([{ id: "org-1", name: "Acme" }]);

    await loginWithApiKey({ profile: "default", isTTY: true });

    expect(switchProfile).toHaveBeenCalledWith("default");
    expect(consola.info).not.toHaveBeenCalledWith(
      expect.stringContaining("Switched active profile"),
    );
  });

  it("switches nothing when the key is rejected with 403", async () => {
    mockLoadAuthConfig.mockReturnValue({ currentProfile: "default", profiles: {} });
    vi.mocked(password).mockResolvedValue("bad-key");
    mockFetchOrganizations.mockRejectedValue({ status: 403, message: "forbidden" });

    await expect(loginWithApiKey({ profile: "staging", isTTY: true })).rejects.toThrow(
      "process.exit",
    );

    expect(setProfile).not.toHaveBeenCalled();
    expect(switchProfile).not.toHaveBeenCalled();
  });
});

describe("loginWithApiKey without prompts", () => {
  const twoOrgs = [
    { id: "org-1", name: "Acme", slug: "acme" },
    { id: "org-2", name: "Globex", slug: "globex" },
  ];

  it("reads the key from stdin with --with-token and stores the --org it names", async () => {
    mockReadStdin.mockResolvedValue("pbk_from_stdin\n");
    mockFetchOrganizations.mockResolvedValue(twoOrgs);

    await loginWithApiKey({ withToken: true, profile: "ci", org: "org-2", isTTY: true });

    expect(mockFetchOrganizations).toHaveBeenCalledWith("pbk_from_stdin");
    expect(setProfile).toHaveBeenCalledWith("ci", {
      method: "api-key",
      token: "pbk_from_stdin",
      orgId: "org-2",
    });
    expect(switchProfile).toHaveBeenCalledWith("ci");
    expect(password).not.toHaveBeenCalled();
    expect(input).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });

  it("prints the stored profile and org under --json", async () => {
    mockReadStdin.mockResolvedValue("pbk_json");
    mockFetchOrganizations.mockResolvedValue(twoOrgs);

    await loginWithApiKey({ withToken: true, profile: "ci", org: "org-1", json: true });

    expect(mockOutputJson).toHaveBeenCalledWith({
      profile: "ci",
      method: "api-key",
      verified: true,
      orgId: "org-1",
      orgName: "Acme",
    });
    expect(consola.success).not.toHaveBeenCalled();
    expect(consola.info).not.toHaveBeenCalled();
  });

  it("reports an unverified key with no org as such under --json", async () => {
    mockReadStdin.mockResolvedValue("pbk_offline");
    mockFetchOrganizations.mockRejectedValue(new TypeError("fetch failed"));

    await loginWithApiKey({ withToken: true, profile: "ci", json: true });

    expect(mockOutputJson).toHaveBeenCalledWith({
      profile: "ci",
      method: "api-key",
      verified: false,
      orgId: null,
      orgName: null,
    });
  });

  it("stores --org as given when the key cannot be verified", async () => {
    mockReadStdin.mockResolvedValue("pbk_offline");
    mockFetchOrganizations.mockRejectedValue(new TypeError("fetch failed"));

    await loginWithApiKey({ withToken: true, profile: "ci", org: "org-9" });

    expect(setProfile).toHaveBeenCalledWith("ci", {
      method: "api-key",
      token: "pbk_offline",
      orgId: "org-9",
    });
  });

  it("refuses an --org the key cannot see and stores nothing", async () => {
    mockReadStdin.mockResolvedValue("pbk_key");
    mockFetchOrganizations.mockResolvedValue(twoOrgs);

    await expect(loginWithApiKey({ withToken: true, profile: "ci", org: "org-9" })).rejects.toThrow(
      "Organization org-9 is not visible to this key",
    );
    expect(setProfile).not.toHaveBeenCalled();
    expect(switchProfile).not.toHaveBeenCalled();
  });

  it("fails naming --org when the key sees several orgs and stdin carried the key", async () => {
    mockReadStdin.mockResolvedValue("pbk_key");
    mockFetchOrganizations.mockResolvedValue(twoOrgs);

    await expect(loginWithApiKey({ withToken: true, profile: "ci", isTTY: true })).rejects.toThrow(
      "Pass --org",
    );
    expect(select).not.toHaveBeenCalled();
    expect(setProfile).not.toHaveBeenCalled();
  });

  it("refuses an empty key on stdin before calling the API", async () => {
    mockReadStdin.mockResolvedValue("  \n");

    await expect(loginWithApiKey({ withToken: true, profile: "ci" })).rejects.toThrow(
      "--with-token read an empty key from stdin.",
    );
    expect(mockFetchOrganizations).not.toHaveBeenCalled();
  });

  it("fails naming --profile before reading the key when there is no terminal", async () => {
    await expect(loginWithApiKey({ withToken: true })).rejects.toThrow("Pass --profile <name>.");
    expect(mockReadStdin).not.toHaveBeenCalled();
    expect(input).not.toHaveBeenCalled();
  });

  it("fails naming --with-token instead of prompting for the key without a terminal", async () => {
    await expect(loginWithApiKey({ profile: "ci", isTTY: false })).rejects.toThrow(
      "Pipe it in with --with-token",
    );
    expect(password).not.toHaveBeenCalled();
    expect(mockFetchOrganizations).not.toHaveBeenCalled();
  });
});
