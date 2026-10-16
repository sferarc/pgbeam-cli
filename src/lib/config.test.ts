import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthProfile } from "./config";

vi.mock("consola", () => ({
  consola: { warn: vi.fn() },
}));

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

let xdg: string;
let dir: string;
let authPath: string;

function writeRaw(content: string, mode = 0o600): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(authPath, content, { mode });
  chmodSync(authPath, mode);
}

function mockConfigFile(content: unknown): void {
  writeRaw(JSON.stringify(content));
}

function mockNoFile(): void {
  rmSync(dir, { recursive: true, force: true });
}

function written(): { currentProfile: string; profiles: Record<string, AuthProfile> } {
  return JSON.parse(readFileSync(authPath, "utf-8"));
}

function mode(path: string): number {
  return statSync(path).mode & 0o777;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  xdg = mkdtempSync(join(tmpdir(), "pgbeam-cli-config-"));
  dir = join(xdg, "pgbeam");
  authPath = join(dir, "auth.json");
  process.env.XDG_CONFIG_HOME = xdg;
});

afterEach(() => {
  delete process.env.XDG_CONFIG_HOME;
  rmSync(xdg, { recursive: true, force: true });
});

describe("loadAuthConfig", () => {
  it("returns empty config when no file exists", () => {
    mockNoFile();

    const config = loadAuthConfig();

    expect(config).toEqual({ currentProfile: "", profiles: {} });
    expect(existsSync(dir)).toBe(false);
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
    writeRaw("{not-valid-json");

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
    writeRaw("null");

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

    expect(readFileSync(authPath, "utf-8")).toBe(`${JSON.stringify(config, null, 2)}\n`);
    expect(mode(authPath)).toBe(0o600);
    expect(mode(dir)).toBe(0o700);
  });

  it("tightens an existing world-readable file and directory", () => {
    mockConfigFile({ currentProfile: "", profiles: {} });
    chmodSync(dir, 0o755);
    chmodSync(authPath, 0o644);

    setProfile("default", oauthProfile);

    expect(mode(authPath)).toBe(0o600);
    expect(mode(dir)).toBe(0o700);
  });

  it("replaces the file through a rename and leaves no temp file behind", () => {
    mockConfigFile({ currentProfile: "default", profiles: { default: oauthProfile } });
    const before = statSync(authPath).ino;

    setProfile("ci", apiKeyProfile);

    expect(statSync(authPath).ino).not.toBe(before);
    expect(readdirSync(dir)).toEqual(["auth.json"]);
  });

  it("moves a corrupted file aside instead of overwriting it", () => {
    writeRaw('{"currentProfile":"default","profiles":{"default":{"method":"oauth","tok');

    setProfile("ci", apiKeyProfile);

    const aside = readdirSync(dir).filter((f) => f.startsWith("auth.json.corrupt-"));
    expect(aside).toHaveLength(1);
    expect(readFileSync(join(dir, aside[0]), "utf-8")).toContain('"default"');
    expect(written()).toEqual({ currentProfile: "ci", profiles: { ci: apiKeyProfile } });
    expect(consola.warn).toHaveBeenCalledWith(expect.stringContaining(aside[0]));
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

    const saved = written();
    expect(saved.currentProfile).toBe("default");
    expect(saved.profiles.default).toEqual(oauthProfile);
  });

  it("does not change current when adding a second profile", () => {
    mockConfigFile({
      currentProfile: "default",
      profiles: { default: oauthProfile },
    });

    setProfile("ci", apiKeyProfile);

    const saved = written();
    expect(saved.currentProfile).toBe("default");
    expect(saved.profiles.ci).toEqual(apiKeyProfile);
  });
});

describe("removeProfile", () => {
  it("removes the profile and saves", () => {
    mockConfigFile({
      currentProfile: "default",
      profiles: { default: oauthProfile, ci: apiKeyProfile },
    });

    removeProfile("ci");

    const saved = written();
    expect(saved.profiles.ci).toBeUndefined();
    expect(saved.currentProfile).toBe("default");
  });

  it("switches current to the next available profile when removing the active one", () => {
    mockConfigFile({
      currentProfile: "default",
      profiles: { default: oauthProfile, ci: apiKeyProfile },
    });

    removeProfile("default");

    const saved = written();
    expect(saved.profiles.default).toBeUndefined();
    expect(saved.currentProfile).toBe("ci");
  });

  it("sets current to empty string when removing the last profile", () => {
    mockConfigFile({
      currentProfile: "default",
      profiles: { default: oauthProfile },
    });

    removeProfile("default");

    const saved = written();
    expect(saved.currentProfile).toBe("");
    expect(Object.keys(saved.profiles)).toHaveLength(0);
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
    const saved = written();
    expect(saved.currentProfile).toBe("ci");
  });

  it("returns false for a non-existent profile and does not save", () => {
    mockConfigFile({
      currentProfile: "default",
      profiles: { default: oauthProfile },
    });

    const result = switchProfile("nope");

    expect(result).toBe(false);
    expect(written().currentProfile).toBe("default");
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
