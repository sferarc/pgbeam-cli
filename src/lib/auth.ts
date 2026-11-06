import { input, password, select } from "@inquirer/prompts";
import { consola } from "consola";
import { type AuthProfile, loadAuthConfig, setProfile, switchProfile } from "./config.js";
import {
  errorStatus,
  fetchOrganizations,
  ORG_ID_DASHBOARD_HINT,
  type OrganizationSummary,
} from "./orgs.js";
import { outputJson } from "./output.js";
import { readStdin } from "./stdin.js";

/**
 * Resolve which organization a fresh login should use. Exactly one visible
 * org is auto-selected; multiple orgs prompt an interactive pick, or fail
 * naming `--org` when there is no terminal to prompt on.
 */
export async function resolveLoginOrg(
  orgs: OrganizationSummary[],
  interactive = true,
): Promise<OrganizationSummary | null> {
  if (orgs.length === 0) return null;
  if (orgs.length === 1) return orgs[0];
  if (!interactive) {
    throw new Error(
      `This key sees ${orgs.length} organizations and there is no terminal to pick one. ` +
        `Pass --org with one of: ${orgs.map((o) => `${o.id} (${o.name})`).join(", ")}.`,
    );
  }
  const id = await select({
    message: "Select an organization:",
    choices: orgs.map((o) => ({ name: `${o.name} (${o.id})`, value: o.id })),
  });
  return orgs.find((o) => o.id === id) ?? null;
}

/** Where a key comes from. The one thing a first-run user does not have. */
const API_KEY_URL = "https://dash.pgbeam.com/settings/account/api-keys";

export interface LoginOptions {
  profile?: string;
  /** Organization ID to store instead of auto-selecting or prompting. */
  org?: string;
  /** Read the key from stdin, like `gh auth login --with-token`. */
  withToken?: boolean;
  json?: boolean;
  /** Override TTY detection (for tests). Defaults to `process.stdin.isTTY`. */
  isTTY?: boolean;
}

async function readKey(opts: LoginOptions, interactive: boolean): Promise<string> {
  if (opts.withToken) {
    const key = (await readStdin()).trim();
    if (!key) throw new Error("--with-token read an empty key from stdin.");
    return key;
  }
  if (!interactive) {
    throw new Error(
      'No terminal to prompt for the API key. Pipe it in with --with-token: printf %s "$KEY" | pgbeam auth login --with-token --profile <name>.',
    );
  }
  // Printed above the prompt rather than left to `--help`. The long description
  // on `auth login` does explain where keys come from, and the help renderer
  // never shows it: a first run reads "Paste your API key:" with nothing saying
  // where to get one, which is the single worst place to make somebody go
  // looking.
  if (!opts.json) consola.info(`Create a key at ${API_KEY_URL}`);
  const token = await password({
    message: "Paste your API key:",
    mask: "*",
  });
  if (!token) {
    consola.error("No API key provided.");
    process.exit(1);
  }
  return token;
}

/** Pick the org named by --org from what the key sees; unverified keys take it as given. */
function pickNamedOrg(
  orgId: string,
  orgs: OrganizationSummary[] | null,
): { id: string; name?: string } {
  if (!orgs) return { id: orgId };
  const match = orgs.find((o) => o.id === orgId);
  if (match) return match;
  const visible = orgs.length ? orgs.map((o) => `${o.id} (${o.name})`).join(", ") : "none";
  throw new Error(
    `Organization ${orgId} is not visible to this key. Nothing was stored. Visible: ${visible}.`,
  );
}

export async function loginWithApiKey(opts: LoginOptions = {}): Promise<void> {
  // Stdin carries the key under --with-token, so no prompt can read from it either.
  const interactive = !opts.withToken && (opts.isTTY ?? Boolean(process.stdin.isTTY));
  if (!interactive && !opts.profile) {
    throw new Error("No terminal to prompt for a profile name. Pass --profile <name>.");
  }

  const token = await readKey(opts, interactive);

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
    opts.profile ??
    (await input({
      message: "Profile name:",
      default: "default",
    }));

  const org = opts.org
    ? pickNamedOrg(opts.org, orgs)
    : orgs
      ? await resolveLoginOrg(orgs, interactive)
      : null;

  const profile: AuthProfile = {
    method: "api-key",
    token,
    ...(org ? { orgId: org.id } : {}),
  };

  const previous = loadAuthConfig().currentProfile;
  setProfile(name, profile);
  switchProfile(name);

  if (opts.json) {
    outputJson({
      profile: name,
      method: profile.method,
      verified: orgs !== null,
      orgId: org?.id ?? null,
      orgName: org?.name ?? null,
    });
    return;
  }

  consola.success(`Logged in as profile "${name}".`);
  if (previous && previous !== name) {
    consola.info(`Switched active profile from "${previous}" to "${name}".`);
  }

  if (org) {
    consola.info(`Using organization ${org.name ? `${org.name} (${org.id})` : org.id}.`);
    consola.info("Next: pgbeam projects list, or pgbeam projects create");
  } else if (orgs && orgs.length === 0) {
    consola.warn(
      "No organizations are visible to this key. Create one in the dashboard, then run `pgbeam orgs switch`.",
    );
  } else {
    consola.info(`Next: pgbeam orgs switch. ${ORG_ID_DASHBOARD_HINT}`);
  }
}
