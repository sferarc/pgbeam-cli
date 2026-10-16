import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { consola } from "consola";

export interface AuthProfile {
  method: "oauth" | "api-key";
  token: string;
  refreshToken?: string;
  expiresAt?: string;
  orgId?: string;
  email?: string;
  label?: string;
}

interface AuthConfig {
  currentProfile: string;
  profiles: Record<string, AuthProfile>;
}

function configDir(): string {
  if (process.platform === "win32") {
    return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "pgbeam");
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg || join(homedir(), ".config");
  return join(base, "pgbeam");
}

function authConfigPath(): string {
  return join(configDir(), "auth.json");
}

function isAuthConfig(value: unknown): value is AuthConfig {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.currentProfile !== "string") return false;
  if (typeof obj.profiles !== "object" || obj.profiles === null || Array.isArray(obj.profiles))
    return false;
  // Validate each profile has at minimum the required fields
  for (const profile of Object.values(obj.profiles as Record<string, unknown>)) {
    if (typeof profile !== "object" || profile === null) return false;
    const p = profile as Record<string, unknown>;
    if (typeof p.method !== "string" || typeof p.token !== "string") return false;
  }
  return true;
}

function parseAuthConfig(raw: string): AuthConfig | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isAuthConfig(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function loadAuthConfig(): AuthConfig {
  const path = authConfigPath();
  if (!existsSync(path)) {
    return { currentProfile: "", profiles: {} };
  }
  const parsed = parseAuthConfig(readFileSync(path, "utf-8"));
  if (!parsed) {
    consola.warn(
      `Corrupted auth config at ${path}. It will be moved to ${path}.corrupt-<timestamp> on the next profile change. Run \`pgbeam auth login\` to reset.`,
    );
    return { currentProfile: "", profiles: {} };
  }
  return parsed;
}

// Writing over a corrupted file would drop every profile it held, so keep it for inspection.
function moveAsideIfCorrupted(path: string): void {
  if (!existsSync(path) || parseAuthConfig(readFileSync(path, "utf-8"))) return;
  const aside = `${path}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  renameSync(path, aside);
  consola.warn(`Moved corrupted auth config to ${aside}.`);
}

function writeFileAtomic(path: string, data: string): void {
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  const fd = openSync(tmp, "wx", 0o600);
  try {
    try {
      writeFileSync(fd, data);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

export function saveAuthConfig(config: AuthConfig): void {
  const path = authConfigPath();
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // mkdir and open modes only apply on creation, so tighten what an older CLI or a restore left behind.
  const posix = process.platform !== "win32";
  if (posix) chmodSync(dir, 0o700);
  moveAsideIfCorrupted(path);
  writeFileAtomic(path, `${JSON.stringify(config, null, 2)}\n`);
  if (posix) chmodSync(path, 0o600);
}

export function getCurrentProfile(): AuthProfile | null {
  const config = loadAuthConfig();
  if (!config.currentProfile || !config.profiles[config.currentProfile]) {
    return null;
  }
  return config.profiles[config.currentProfile];
}

export function getProfile(name: string): AuthProfile | null {
  const config = loadAuthConfig();
  return config.profiles[name] ?? null;
}

export function setProfile(name: string, profile: AuthProfile): void {
  const config = loadAuthConfig();
  config.profiles[name] = profile;
  if (!config.currentProfile) {
    config.currentProfile = name;
  }
  saveAuthConfig(config);
}

export function removeProfile(name: string): void {
  const config = loadAuthConfig();
  delete config.profiles[name];
  if (config.currentProfile === name) {
    const remaining = Object.keys(config.profiles);
    config.currentProfile = remaining[0] ?? "";
  }
  saveAuthConfig(config);
}

export function switchProfile(name: string): boolean {
  const config = loadAuthConfig();
  if (!config.profiles[name]) return false;
  config.currentProfile = name;
  saveAuthConfig(config);
  return true;
}

export function listProfiles(): { name: string; profile: AuthProfile; active: boolean }[] {
  const config = loadAuthConfig();
  return Object.entries(config.profiles).map(([name, profile]) => ({
    name,
    profile,
    active: name === config.currentProfile,
  }));
}
