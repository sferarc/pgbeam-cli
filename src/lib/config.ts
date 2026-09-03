import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

export function loadAuthConfig(): AuthConfig {
  const path = authConfigPath();
  if (!existsSync(path)) {
    return { currentProfile: "", profiles: {} };
  }
  const raw = readFileSync(path, "utf-8");
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isAuthConfig(parsed)) {
      throw new Error("invalid shape");
    }
    return parsed;
  } catch {
    consola.warn("Corrupted auth config. Run `pgbeam auth login` to reset.");
    return { currentProfile: "", profiles: {} };
  }
}

export function saveAuthConfig(config: AuthConfig): void {
  const path = authConfigPath();
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
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
