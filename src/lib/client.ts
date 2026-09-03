import { type ApiClient, ApiError, PgBeamClient } from "pgbeam";
import { getCurrentProfile, getProfile } from "./config.js";
import type { GlobalArgs } from "./flags.js";
import { loadProjectLink } from "./project.js";

const DEFAULT_API_URL = "https://api.pgbeam.com";

// Canonical API-key env var is PGBEAM_API_KEY (matches the Terraform/Crossplane/
// Pulumi providers). PGBEAM_TOKEN and PGBEAM_API_TOKEN are accepted as aliases so
// the CLI, the providers, and older docs all keep working; the canonical one wins.
const TOKEN_ENV_VARS = ["PGBEAM_API_KEY", "PGBEAM_TOKEN", "PGBEAM_API_TOKEN"] as const;

function envToken(): string | null {
  for (const name of TOKEN_ENV_VARS) {
    const value = process.env[name];
    if (value) return value;
  }
  return null;
}

interface ResolvedContext {
  client: ApiClient;
  orgId: string | null;
  projectId: string | null;
}

type TokenSource = "flag" | "profile-flag" | "env" | "env-profile" | "profile" | "none";

export interface AuthState {
  token: string | null;
  source: TokenSource;
  orgId: string | null;
  method: string | null;
}

/**
 * Resolve the auth token the same way every command does, tracking where it came
 * from. Exported so `auth status`/`whoami` report the exact credential the rest
 * of the CLI would use (including PGBEAM_API_KEY / --token), instead of only
 * looking at the stored profile.
 */
export function resolveAuthState(args: GlobalArgs): AuthState {
  // 1. --token flag
  if (args.token) {
    return { token: args.token, source: "flag", orgId: args.org ?? null, method: "api-key" };
  }

  // 2. --profile flag
  if (args.profile) {
    const profile = getProfile(args.profile);
    if (profile) {
      return {
        token: profile.token,
        source: "profile-flag",
        orgId: profile.orgId ?? null,
        method: profile.method,
      };
    }
    throw new Error(`Profile "${args.profile}" not found.`);
  }

  // 3. API-key env var (canonical PGBEAM_API_KEY, plus aliases)
  const fromEnv = envToken();
  if (fromEnv) {
    return { token: fromEnv, source: "env", orgId: args.org ?? null, method: "api-key" };
  }

  // 4. PGBEAM_PROFILE env var
  const envProfile = process.env.PGBEAM_PROFILE;
  if (envProfile) {
    const profile = getProfile(envProfile);
    if (profile) {
      return {
        token: profile.token,
        source: "env-profile",
        orgId: profile.orgId ?? null,
        method: profile.method,
      };
    }
    throw new Error(`Profile "${envProfile}" (from PGBEAM_PROFILE) not found.`);
  }

  // 5. Current profile
  const current = getCurrentProfile();
  if (current) {
    return {
      token: current.token,
      source: "profile",
      orgId: current.orgId ?? null,
      method: current.method,
    };
  }

  return { token: null, source: "none", orgId: null, method: null };
}

function resolveToken(args: GlobalArgs): string | null {
  return resolveAuthState(args).token;
}

export function resolveContext(args: GlobalArgs): ResolvedContext {
  const token = resolveToken(args);

  if (!token) {
    throw new Error(
      "Not authenticated. Run `pgbeam auth login` first, or create a key at https://dash.pgbeam.com/settings/account/api-keys.",
    );
  }

  const baseUrl = apiBaseUrl();

  const pgbeam = new PgBeamClient({ token, baseUrl });
  const client = pgbeam.api;

  // Resolve org: --org flag > --profile flag > PGBEAM_PROFILE env > current profile
  let orgId: string | null = args.org ?? null;
  if (!orgId) {
    const profileName = args.profile ?? process.env.PGBEAM_PROFILE;
    if (profileName) {
      const profile = getProfile(profileName);
      orgId = profile?.orgId ?? null;
    } else {
      const current = getCurrentProfile();
      orgId = current?.orgId ?? null;
    }
  }

  // Resolve project: --project flag > .pgbeam/project.json
  let projectId: string | null = args.project ?? null;
  if (!projectId) {
    const link = loadProjectLink();
    projectId = link?.projectId ?? null;
  }

  return { client, orgId, projectId };
}

export function requireProject(ctx: ResolvedContext): string {
  if (!ctx.projectId) {
    throw new Error("No project linked. Run `pgbeam link` or pass --project.");
  }
  return ctx.projectId;
}

export function requireOrg(ctx: ResolvedContext): string {
  if (!ctx.orgId) {
    throw new Error(
      "No organization set. Run `pgbeam orgs switch` to pick one, or pass --org. " +
        "To copy your organization ID from the dashboard, open Settings > Organization " +
        "(the Organization ID field has a copy button).",
    );
  }
  return ctx.orgId;
}

/** The API base URL every command targets (PGBEAM_API_URL overrides the default). */
export function apiBaseUrl(): string {
  return process.env.PGBEAM_API_URL ?? DEFAULT_API_URL;
}

/** Make a raw API request (untyped, for dynamic dispatch). */
export async function rawRequest(
  args: GlobalArgs,
  method: string,
  path: string,
  options?: {
    pathParams?: Record<string, string>;
    queryParams?: Record<string, string>;
    body?: unknown;
  },
): Promise<unknown> {
  const token = resolveToken(args);
  if (!token) {
    throw new Error(
      "Not authenticated. Run `pgbeam auth login` first, or create a key at https://dash.pgbeam.com/settings/account/api-keys.",
    );
  }

  let url = path;
  if (options?.pathParams) {
    for (const [key, value] of Object.entries(options.pathParams)) {
      url = url.replace(`{${key}}`, encodeURIComponent(value));
    }
  }

  const baseUrl = apiBaseUrl();
  const fullUrl = new URL(url, baseUrl);

  if (options?.queryParams) {
    for (const [key, value] of Object.entries(options.queryParams)) {
      fullUrl.searchParams.set(key, value);
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (options?.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(fullUrl.toString(), {
    method,
    headers,
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    // Throw the SDK's ApiError (status + parsed body) so rawRequest failures
    // flow through the same status-aware error branch in errors.ts as every
    // SDK call, including remediation hints and response body display.
    const errorBody: unknown = await response.json().catch(() => null);
    throw new ApiError(response.status, response.statusText, errorBody);
  }

  if (response.status === 204) return undefined;

  const contentType = response.headers.get("content-type");
  if (contentType?.includes("application/json")) {
    return response.json();
  }
  return response.text();
}
