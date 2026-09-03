import { type OrganizationSummary, PgBeamClient } from "pgbeam";
import { apiBaseUrl } from "./client.js";

export type { OrganizationSummary };

/**
 * Where to find an organization ID by hand, for the fallback paths where the
 * API cannot be asked for it. Shared by login, `orgs switch`, and the
 * "no organization set" error so every dead end names the same place.
 */
export const ORG_ID_DASHBOARD_HINT =
  "You can copy your organization ID from the dashboard under Settings > Organization.";

/** Narrow an unknown error to one carrying an HTTP status (SDK/API errors do). */
export function errorStatus(err: unknown): number | null {
  if (err && typeof err === "object" && "status" in err) {
    const status = (err as { status: unknown }).status;
    if (typeof status === "number") return status;
  }
  return null;
}

/**
 * List the organizations visible to a token via the public
 * `GET /v1/organizations` operation. Used to validate a key at login, to power
 * `orgs list`/`orgs switch`, and to verify credentials in `auth status`.
 * Throws the SDK error on failure (carrying `status` for HTTP errors).
 */
export async function fetchOrganizations(token: string): Promise<OrganizationSummary[]> {
  const client = new PgBeamClient({ token, baseUrl: apiBaseUrl() });
  const result = await client.api.account.listOrganizations();
  return result.organizations;
}
