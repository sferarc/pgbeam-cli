import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(),
  select: vi.fn(),
}));

vi.mock("consola", () => ({
  consola: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../../lib/config.js", () => ({
  loadAuthConfig: vi.fn(),
  saveAuthConfig: vi.fn(),
}));

vi.mock("../../lib/client.js", () => ({
  resolveAuthState: vi.fn(() => ({
    token: "tok-1",
    source: "profile",
    orgId: null,
    method: "api-key",
  })),
}));

vi.mock("../../lib/errors.js", () => ({
  runCommand: vi.fn(async (fn: () => Promise<void>) => fn()),
}));

const mockFetchOrganizations = vi.fn();
vi.mock("../../lib/orgs.js", () => ({
  ORG_ID_DASHBOARD_HINT:
    "You can copy your organization ID from the dashboard under Settings > Organization.",
  errorStatus: (err: unknown) =>
    err && typeof err === "object" && "status" in err
      ? ((err as { status: number }).status ?? null)
      : null,
  fetchOrganizations: (...args: unknown[]) => mockFetchOrganizations(...args),
}));

import { input, select } from "@inquirer/prompts";
import { consola } from "consola";
import { loadAuthConfig, saveAuthConfig } from "../../lib/config.js";
import switchCommand from "./switch.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
class ExitError extends Error {
  code: number;
  constructor(code: number) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
  throw new ExitError(code as number);
});

function buildArgs(overrides: Record<string, unknown> = {}) {
  return {
    json: false,
    "no-color": false,
    debug: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
});

describe("orgs switch", () => {
  it("switches org for the current profile with positional arg", async () => {
    vi.mocked(loadAuthConfig).mockReturnValue({
      currentProfile: "default",
      profiles: {
        default: { method: "oauth", token: "tok-1", orgId: "old-org" },
      },
    });

    await switchCommand.run?.({ args: buildArgs({ id: "org-new" }) } as never);

    expect(saveAuthConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        profiles: {
          default: expect.objectContaining({ orgId: "org-new" }),
        },
      }),
    );
    expect(consola.success).toHaveBeenCalledWith("Switched to organization org-new.");
    expect(mockFetchOrganizations).not.toHaveBeenCalled();
  });

  it("lists organizations and prompts a pick when no ID is provided", async () => {
    vi.mocked(loadAuthConfig).mockReturnValue({
      currentProfile: "default",
      profiles: {
        default: { method: "api-key", token: "tok-1" },
      },
    });
    mockFetchOrganizations.mockResolvedValue([
      { id: "org-a", name: "Acme", slug: "acme" },
      { id: "org-b", name: "Globex", slug: "globex" },
    ]);
    vi.mocked(select).mockResolvedValue("org-b");

    await switchCommand.run?.({ args: buildArgs() } as never);

    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Select an organization:",
        choices: [
          { name: "Acme (org-a)", value: "org-a" },
          { name: "Globex (org-b)", value: "org-b" },
        ],
      }),
    );
    expect(saveAuthConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        profiles: {
          default: expect.objectContaining({ orgId: "org-b" }),
        },
      }),
    );
  });

  it("auto-selects when exactly one organization is visible", async () => {
    vi.mocked(loadAuthConfig).mockReturnValue({
      currentProfile: "default",
      profiles: {
        default: { method: "api-key", token: "tok-1" },
      },
    });
    mockFetchOrganizations.mockResolvedValue([{ id: "org-solo", name: "Solo", slug: "solo" }]);

    await switchCommand.run?.({ args: buildArgs() } as never);

    expect(select).not.toHaveBeenCalled();
    expect(input).not.toHaveBeenCalled();
    expect(saveAuthConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        profiles: {
          default: expect.objectContaining({ orgId: "org-solo" }),
        },
      }),
    );
    expect(consola.info).toHaveBeenCalledWith(expect.stringContaining("Solo (org-solo)"));
  });

  it("errors with a dashboard hint when the credential sees no organizations", async () => {
    vi.mocked(loadAuthConfig).mockReturnValue({
      currentProfile: "default",
      profiles: {
        default: { method: "api-key", token: "tok-1" },
      },
    });
    mockFetchOrganizations.mockResolvedValue([]);

    await expect(switchCommand.run?.({ args: buildArgs() } as never)).rejects.toThrow(
      "process.exit(1)",
    );

    expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("Settings > Organization"));
  });

  it("falls back to manual entry when the API is unreachable", async () => {
    vi.mocked(loadAuthConfig).mockReturnValue({
      currentProfile: "default",
      profiles: {
        default: { method: "oauth", token: "tok-1" },
      },
    });
    mockFetchOrganizations.mockRejectedValue(new TypeError("fetch failed"));
    vi.mocked(input).mockResolvedValue("org-prompted");

    await switchCommand.run?.({ args: buildArgs() } as never);

    expect(consola.warn).toHaveBeenCalledWith(expect.stringContaining("Settings > Organization"));
    expect(input).toHaveBeenCalledWith({ message: "Organization ID:" });
    expect(saveAuthConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        profiles: {
          default: expect.objectContaining({ orgId: "org-prompted" }),
        },
      }),
    );
  });

  it("rethrows HTTP errors from the org listing (e.g. 401)", async () => {
    vi.mocked(loadAuthConfig).mockReturnValue({
      currentProfile: "default",
      profiles: {
        default: { method: "api-key", token: "tok-1" },
      },
    });
    mockFetchOrganizations.mockRejectedValue({ status: 401, message: "unauthorized" });

    await expect(switchCommand.run?.({ args: buildArgs() } as never)).rejects.toMatchObject({
      status: 401,
    });
    expect(saveAuthConfig).not.toHaveBeenCalled();
  });

  it("uses --profile flag to target a specific profile", async () => {
    vi.mocked(loadAuthConfig).mockReturnValue({
      currentProfile: "default",
      profiles: {
        default: { method: "oauth", token: "tok-1" },
        ci: { method: "api-key", token: "tok-2" },
      },
    });

    await switchCommand.run?.({ args: buildArgs({ id: "org-ci", profile: "ci" }) } as never);

    expect(saveAuthConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        profiles: expect.objectContaining({
          ci: expect.objectContaining({ orgId: "org-ci" }),
        }),
      }),
    );
  });

  it("exits with error when not authenticated", async () => {
    vi.mocked(loadAuthConfig).mockReturnValue({
      currentProfile: "",
      profiles: {},
    });

    await expect(
      switchCommand.run?.({ args: buildArgs({ id: "org-1" }) } as never),
    ).rejects.toThrow("process.exit(1)");

    expect(consola.error).toHaveBeenCalledWith("Not authenticated. Run `pgbeam auth login` first.");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with error when the entered org ID is empty", async () => {
    vi.mocked(loadAuthConfig).mockReturnValue({
      currentProfile: "default",
      profiles: {
        default: { method: "oauth", token: "tok-1" },
      },
    });
    mockFetchOrganizations.mockRejectedValue(new TypeError("fetch failed"));
    vi.mocked(input).mockResolvedValue("   ");

    await expect(switchCommand.run?.({ args: buildArgs() } as never)).rejects.toThrow(
      "process.exit(1)",
    );

    expect(consola.error).toHaveBeenCalledWith("Organization ID cannot be empty.");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
