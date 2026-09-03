import { defineCommand } from "citty";
import { consola } from "consola";
import { resolveAuthState } from "../../lib/client.js";
import { loadAuthConfig } from "../../lib/config.js";
import { globalArgs } from "../../lib/flags.js";
import { errorStatus, fetchOrganizations, type OrganizationSummary } from "../../lib/orgs.js";
import { output } from "../../lib/output.js";

const SOURCE_LABELS: Record<string, string> = {
  flag: "--token flag",
  "profile-flag": "--profile flag",
  env: "PGBEAM_API_KEY env",
  "env-profile": "PGBEAM_PROFILE env",
  profile: "saved profile",
};

/** Mask a credential for display: keep the key prefix and the last 4 characters. */
export function maskKey(token: string): string {
  if (token.length <= 12) return `${token.slice(0, 4)}...`;
  const prefixMatch = /^[a-z]+_/.exec(token);
  const prefix = prefixMatch ? prefixMatch[0] : token.slice(0, 4);
  return `${prefix}...${token.slice(-4)}`;
}

interface Verification {
  /** true = accepted by the API, false = rejected (401/403), null = API unreachable. */
  verified: boolean | null;
  orgs: OrganizationSummary[] | null;
  status: number | null;
}

/** Check the credential against the API with a cheap authenticated call. */
async function verifyCredential(token: string): Promise<Verification> {
  try {
    const orgs = await fetchOrganizations(token);
    return { verified: true, orgs, status: null };
  } catch (err) {
    const status = errorStatus(err);
    if (status === 401 || status === 403) {
      return { verified: false, orgs: null, status };
    }
    // Network problem or unexpected server error: report "not verified"
    // rather than failing, so the command degrades gracefully offline.
    return { verified: null, orgs: null, status };
  }
}

export default defineCommand({
  meta: {
    name: "status",
    description: "Show current authentication status",
    docs: {
      longDescription:
        "Display the credential the CLI would use (masked), where it came from (profile, flag, or environment), the authentication method, organization, and email. When the API is reachable, the credential is verified live with a cheap authenticated call; offline, the stored details are shown unverified. If not authenticated, prints a warning with instructions to log in. Also available as the `pgbeam whoami` alias.",
      examples: [
        { comment: "Check who you are authenticated as", command: "pgbeam auth status" },
        { comment: "Same thing, using the alias", command: "pgbeam whoami" },
        { comment: "Get auth status as JSON for scripting", command: "pgbeam auth status --json" },
      ],
      response:
        "Displays profile name (or credential source), method, masked key, email, organization, and live verification result. With `--json`, returns an object with `authenticated`, `verified`, `profile`, `source`, `method`, `key`, `orgId`, `orgName`, and `email` fields. Exits non-zero when the credential is missing or rejected by the API.",
    },
  },
  args: {
    ...globalArgs,
  },
  async run({ args }) {
    const config = loadAuthConfig();
    const auth = resolveAuthState(args);

    if (!auth.token) {
      if (args.json) {
        output({ authenticated: false }, true);
      } else {
        consola.warn("Not authenticated. Run `pgbeam auth login` to get started.");
      }
      // Signal failure so scripts can branch on identity: a status command that
      // cannot determine who you are must not report success.
      process.exitCode = 1;
      return;
    }

    // When the credential came from a stored profile, surface the profile's
    // extra details (email, expiry).
    const profileName =
      auth.source === "profile"
        ? config.currentProfile
        : auth.source === "profile-flag"
          ? (args.profile ?? null)
          : auth.source === "env-profile"
            ? (process.env.PGBEAM_PROFILE ?? null)
            : null;
    const profile = profileName ? config.profiles[profileName] : undefined;

    const check = await verifyCredential(auth.token);
    const orgName = auth.orgId
      ? (check.orgs?.find((o) => o.id === auth.orgId)?.name ?? null)
      : null;

    const info = {
      authenticated: check.verified !== false,
      verified: check.verified,
      profile: profileName || null,
      source: auth.source,
      method: auth.method,
      key: maskKey(auth.token),
      orgId: auth.orgId,
      orgName,
      email: profile?.email ?? null,
    };

    output(info, args.json, () => {
      if (info.profile) {
        consola.log(`Profile:  ${info.profile}`);
      } else {
        consola.log(`Source:   ${SOURCE_LABELS[auth.source] ?? auth.source}`);
      }
      if (auth.method) consola.log(`Method:   ${auth.method}`);
      consola.log(`Key:      ${info.key}`);
      if (info.email) consola.log(`Email:    ${info.email}`);
      if (auth.orgId)
        consola.log(`Org:      ${orgName ? `${orgName} (${auth.orgId})` : auth.orgId}`);
      if (profile?.expiresAt) consola.log(`Expires:  ${profile.expiresAt}`);
      if (check.verified === true) {
        consola.log("Verified: yes (accepted by the API)");
      } else if (check.verified === null) {
        consola.log("Verified: no (API unreachable, showing stored details)");
      }
    });

    if (check.verified === false) {
      consola.warn(
        `The credential was rejected by the API (${check.status}). Run \`pgbeam auth login\` to re-authenticate.`,
      );
      process.exitCode = 1;
    }
  },
});
