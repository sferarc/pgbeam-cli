import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthProfile } from "./config";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/home/testuser"),
}));

vi.mock("consola", () => ({
  consola: { warn: vi.fn() },
}));

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { consola } from "consola";
import {
  getCurrentProfile,
  getProfile,
  listProfiles,
  loadAuthConfig,
  removeProfile,
  saveAuthConfig,
  setProfile,
  switchProfile,
} from "./config";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const oauthProfile: AuthProfile = {
  method: "oauth",
  token: "tok-1",
  refreshToken: "ref-1",
  expiresAt: "2099-01-01T00:00:00Z",
  orgId: "org-1",
  email: "a@b.com",
};

const apiKeyProfile: AuthProfile = {
  method: "api-key",
  token: "key-2",
  label: "ci",
};

function mockConfigFile(content: unknown): void {
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readFileSync).mockReturnValue(JSON.stringify(content));
}

function mockNoFile(): void {
  vi.mocked(existsSync).mockReturnValue(false);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.XDG_CONFIG_HOME;
});

describe("loadAuthConfig", () => {
  it("returns empty config when no file exists", () => {
    mockNoFile();

    const config = loadAuthConfig();

    expect(config).toEqual({ currentProfile: "", profiles: {} });
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it("returns parsed config from valid JSON", () => {
    const stored = {
      currentProfile: "default",
      profiles: { default: oauthProfile },
    };
    mockConfigFile(stored);

    const config = loadAuthConfig();

    expect(config).toEqual(stored);
  });

  it("returns empty config and warns on corrupted JSON", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue("{not-valid-json");

    const config = loadAuthConfig();

    expect(config).toEqual({ currentProfile: "", profiles: {} });
    expect(consola.warn).toHaveBeenCalledWith(expect.stringContaining("Corrupted auth config"));
  });

  it("returns empty config when JSON has invalid shape (missing profiles)", () => {
    mockConfigFile({ currentProfile: "x" });

    const config = loadAuthConfig();

    expect(config).toEqual({ currentProfile: "", profiles: {} });
    expect(consola.warn).toHaveBeenCalled();
  });

  it("returns empty config when JSON is null", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue("null");

    const config = loadAuthConfig();

    expect(config).toEqual({ currentProfile: "", profiles: {} });
    expect(consola.warn).toHaveBeenCalled();
  });
});

describe("saveAuthConfig", () => {
  it("writes JSON with correct format and permissions", () => {
    const config = {
      currentProfile: "default",
      profiles: { default: oauthProfile },
    };

    saveAuthConfig(config);

    expect(mkdirSync).toHaveBeenCalledWith(expect.stringContaining("pgbeam"), {
      recursive: true,
      mode: 0o700,
    });
    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("auth.json"),
      `${JSON.stringify(config, null, 2)}\n`,
      { mode: 0o600 },
    );
  });
});

describe("getCurrentProfile", () => {
  it("returns null when no profiles exist", () => {
    mockConfigFile({ currentProfile: "", profiles: {} });

    expect(getCurrentProfile()).toBeNull();
  });

  it("returns null when currentProfile points to a missing entry", () => {
    mockConfigFile({ currentProfile: "gone", profiles: {} });

    expect(getCurrentProfile()).toBeNull();
  });

  it("returns the current profile when it exists", () => {
    mockConfigFile({
      currentProfile: "default",
      profiles: { default: oauthProfile },
    });

    expect(getCurrentProfile()).toEqual(oauthProfile);
  });
});

describe("getProfile", () => {
  it("returns the profile by name", () => {
    mockConfigFile({
      currentProfile: "default",
      profiles: { default: oauthProfile, ci: apiKeyProfile },
    });

    expect(getProfile("ci")).toEqual(apiKeyProfile);
  });

  it("returns null for a non-existent profile name", () => {
    mockConfigFile({ currentProfile: "", profiles: {} });

    expect(getProfile("nope")).toBeNull();
  });
});

describe("setProfile", () => {
  it("sets new profile as current when it is the first profile", () => {
    mockConfigFile({ currentProfile: "", profiles: {} });

    setProfile("default", oauthProfile);

    const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string);
    expect(written.currentProfile).toBe("default");
    expect(written.profiles.default).toEqual(oauthProfile);
  });

  it("does not change current when adding a second profile", () => {
    mockConfigFile({
      currentProfile: "default",
      profiles: { default: oauthProfile },
    });

    setProfile("ci", apiKeyProfile);

    const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string);
    expect(written.currentProfile).toBe("default");
    expect(written.profiles.ci).toEqual(apiKeyProfile);
  });
});

describe("removeProfile", () => {
  it("removes the profile and saves", () => {
    mockConfigFile({
      currentProfile: "default",
      profiles: { default: oauthProfile, ci: apiKeyProfile },
    });

    removeProfile("ci");

    const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string);
    expect(written.profiles.ci).toBeUndefined();
    expect(written.currentProfile).toBe("default");
  });

  it("switches current to the next available profile when removing the active one", () => {
    mockConfigFile({
      currentProfile: "default",
      profiles: { default: oauthProfile, ci: apiKeyProfile },
    });

    removeProfile("default");

    const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string);
    expect(written.profiles.default).toBeUndefined();
    expect(written.currentProfile).toBe("ci");
  });

  it("sets current to empty string when removing the last profile", () => {
    mockConfigFile({
      currentProfile: "default",
      profiles: { default: oauthProfile },
    });

    removeProfile("default");

    const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string);
    expect(written.currentProfile).toBe("");
    expect(Object.keys(written.profiles)).toHaveLength(0);
  });
});

describe("switchProfile", () => {
  it("returns true and updates current for a valid profile", () => {
    mockConfigFile({
      currentProfile: "default",
      profiles: { default: oauthProfile, ci: apiKeyProfile },
    });

    const result = switchProfile("ci");

    expect(result).toBe(true);
    const written = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string);
    expect(written.currentProfile).toBe("ci");
  });

  it("returns false for a non-existent profile and does not save", () => {
    mockConfigFile({
      currentProfile: "default",
      profiles: { default: oauthProfile },
    });

    const result = switchProfile("nope");

    expect(result).toBe(false);
    expect(writeFileSync).not.toHaveBeenCalled();
  });
});

describe("listProfiles", () => {
  it("returns all profiles with correct active flag", () => {
    mockConfigFile({
      currentProfile: "ci",
      profiles: { default: oauthProfile, ci: apiKeyProfile },
    });

    const list = listProfiles();

    expect(list).toHaveLength(2);
    expect(list).toContainEqual({
      name: "default",
      profile: oauthProfile,
      active: false,
    });
    expect(list).toContainEqual({
      name: "ci",
      profile: apiKeyProfile,
      active: true,
    });
  });

  it("returns empty array when no profiles exist", () => {
    mockConfigFile({ currentProfile: "", profiles: {} });

    expect(listProfiles()).toEqual([]);
  });
});
