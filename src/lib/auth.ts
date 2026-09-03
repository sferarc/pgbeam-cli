import { input, password, select } from "@inquirer/prompts";
import { consola } from "consola";
import { type AuthProfile, setProfile } from "./config.js";
import {
  errorStatus,
  fetchOrganizations,
  ORG_ID_DASHBOARD_HINT,
  type OrganizationSummary,
} from "./orgs.js";

/**
 * Resolve which organization a fresh login should use. Exactly one visible
 * org is auto-selected; multiple orgs prompt an interactive pick.
 */
export async function resolveLoginOrg(
  orgs: OrganizationSummary[],
): Promise<OrganizationSummary | null> {
  if (orgs.length === 0) return null;
  if (orgs.length === 1) return orgs[0];
  const id = await select({
    message: "Select an organization:",
    choices: orgs.map((o) => ({ name: `${o.name} (${o.id})`, value: o.id })),
  });
  return orgs.find((o) => o.id === id) ?? null;
}

/** Where a key comes from. The one thing a first-run user does not have. */
const API_KEY_URL = "https://dash.pgbeam.com/settings/account/api-keys";

export async function loginWithApiKey(profileName?: string): Promise<void> {
  // Printed above the prompt rather than left to `--help`. The long description
  // on `auth login` does explain where keys come from, and the help renderer
  // never shows it: a first run reads "Paste your API key:" with nothing saying
  // where to get one, which is the single worst place to make somebody go
  // looking.
  consola.info(`Create a key at ${API_KEY_URL}`);
  const token = await password({
    message: "Paste your API key:",
    mask: "*",
  });

  if (!token) {
    consola.error("No API key provided.");
    process.exit(1);
  }

  // Validate the key with a cheap authenticated call before storing it, and
  // use the same response to resolve the organization so the first-run path
  // needs no manual org ID lookup.
  let orgs: OrganizationSummary[] | null = null;
  try {
    orgs = await fetchOrganizations(token);
  } catch (err) {
    const status = errorStatus(err);
    if (status === 401 || status === 403) {
      consola.error(
        `The API key was rejected (${status}). Nothing was stored. ` +
          "Check the key and try again; keys are created in the dashboard under Settings > API Keys.",
      );
      process.exit(1);
    }
    consola.warn("Could not reach the API to verify the key. Storing it unverified.");
  }

  const name =
    profileName ??
    (await input({
      message: "Profile name:",
      default: "default",
    }));

  const org = orgs ? await resolveLoginOrg(orgs) : null;

  const profile: AuthProfile = {
    method: "api-key",
    token,
    ...(org ? { orgId: org.id } : {}),
  };

  setProfile(name, profile);
  consola.success(`Logged in as profile "${name}".`);

  if (org) {
    consola.info(`Using organization ${org.name} (${org.id}).`);
    consola.info("Next: pgbeam projects list, or pgbeam projects create");
  } else if (orgs && orgs.length === 0) {
    consola.warn(
      "No organizations are visible to this key. Create one in the dashboard, then run `pgbeam orgs switch`.",
    );
  } else {
    consola.info(`Next: pgbeam orgs switch. ${ORG_ID_DASHBOARD_HINT}`);
  }
}
