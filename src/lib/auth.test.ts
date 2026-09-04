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

vi.mock("./config.js", () => ({
  setProfile: vi.fn(),
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

import { input, password, select } from "@inquirer/prompts";
import { consola } from "consola";
import { loginWithApiKey, resolveLoginOrg } from "./auth";
import { setProfile } from "./config.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
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
});

describe("loginWithApiKey", () => {
  it("validates the key, auto-selects a single org, and stores it in the profile", async () => {
    vi.mocked(password).mockResolvedValue("my-api-key");
    vi.mocked(input).mockResolvedValue("ci");
    mockFetchOrganizations.mockResolvedValue([{ id: "org-1", name: "Acme", slug: "acme" }]);

    await loginWithApiKey();

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

    await loginWithApiKey();

    expect(setProfile).toHaveBeenCalledWith("default", {
      method: "api-key",
      token: "key-123",
      orgId: "org-2",
    });
  });

  it("rejects the login on 401 without storing anything", async () => {
    vi.mocked(password).mockResolvedValue("bad-key");
    mockFetchOrganizations.mockRejectedValue({ status: 401, message: "unauthorized" });

    await expect(loginWithApiKey()).rejects.toThrow("process.exit");

    expect(setProfile).not.toHaveBeenCalled();
    expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("rejected (401)"));
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("stores the key unverified when the API is unreachable", async () => {
    vi.mocked(password).mockResolvedValue("offline-key");
    vi.mocked(input).mockResolvedValue("default");
    mockFetchOrganizations.mockRejectedValue(new TypeError("fetch failed"));

    await loginWithApiKey();

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

    await loginWithApiKey();

    expect(setProfile).toHaveBeenCalledWith("default", {
      method: "api-key",
      token: "orphan-key",
    });
    expect(consola.warn).toHaveBeenCalledWith(expect.stringContaining("No organizations"));
  });

  it("uses the provided profile name without prompting", async () => {
    vi.mocked(password).mockResolvedValue("my-api-key");
    mockFetchOrganizations.mockResolvedValue([{ id: "org-1", name: "Acme", slug: "acme" }]);

    await loginWithApiKey("custom-profile");

    expect(input).not.toHaveBeenCalled();
    expect(setProfile).toHaveBeenCalledWith("custom-profile", {
      method: "api-key",
      token: "my-api-key",
      orgId: "org-1",
    });
  });

  it("exits with error when no API key is provided", async () => {
    vi.mocked(password).mockResolvedValue("");

    await expect(loginWithApiKey()).rejects.toThrow("process.exit");

    expect(consola.error).toHaveBeenCalledWith("No API key provided.");
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(mockFetchOrganizations).not.toHaveBeenCalled();
  });

  it("prompts for a profile name when none is given", async () => {
    vi.mocked(password).mockResolvedValue("key-123");
    vi.mocked(input).mockResolvedValue("default");
    mockFetchOrganizations.mockResolvedValue([{ id: "org-1", name: "Acme", slug: "acme" }]);

    await loginWithApiKey();

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

    await loginWithApiKey();

    expect(consola.info).toHaveBeenCalledWith(expect.stringContaining("pgbeam projects list"));
  });
});
