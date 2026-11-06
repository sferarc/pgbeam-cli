import { defineCommand } from "citty";
import { loginWithApiKey } from "../../lib/auth.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";

export default defineCommand({
  meta: {
    name: "login",
    description: "Authenticate with PgBeam",
    docs: {
      longDescription:
        "Authenticate with PgBeam to access your projects and databases. Login uses an API key, which you generate from the PgBeam dashboard under Settings > API Keys; running the command prompts you to paste it. The key is verified against the API before it is stored (an invalid key fails the login), and your organization is resolved automatically: a single visible organization is selected for you, multiple organizations prompt a pick. Credentials are stored in a local profile on disk (`~/.config/pgbeam/`), and the profile you log into becomes the active one for subsequent commands. You can maintain multiple profiles for different environments using the `--profile` flag, and move between them with `pgbeam auth switch`. For scripts and agents, `--with-token` reads the key from stdin and `--org` names the organization, so `--with-token --profile <name> --org <id>` logs in with no prompt. Without a terminal, any prompt the flags leave open fails at once and names the flag that replaces it.",
      examples: [
        { comment: "Login with an API key (prompts for the key)", command: "pgbeam auth login" },
        {
          comment: "Login with an API key and save to a named profile",
          command: "pgbeam auth login --profile production",
        },
        {
          comment: "Login without prompts, reading the key from stdin",
          command:
            'printf %s "$PGBEAM_KEY" | pgbeam auth login --with-token --profile ci --org org_xxx',
        },
      ],
      response:
        "On success, prints a confirmation with the authenticated profile name and the selected organization, ready for `pgbeam projects list`. When the login replaces a different active profile, it also names the profile it switched from. The token is stored locally and used for all subsequent commands. A key the API rejects (401) is not stored and the command exits non-zero, as does an `--org` the key cannot see. With `--json`, prints an object with `profile`, `method`, `verified` (false when the API was unreachable and the key was stored unverified), `orgId` and `orgName` (null when no organization was resolved).",
    },
  },
  args: {
    ...globalArgs,
    // Kept for backwards compatibility with scripts and older docs. API key is
    // the only login method, so the flag is accepted but changes nothing.
    "api-key": {
      type: "boolean",
      description: "Authenticate with an API key (the default and only method)",
      default: false,
    },
    "with-token": {
      type: "boolean",
      description: "Read the API key from stdin instead of prompting",
      default: false,
    },
  },
  async run({ args }) {
    // API key is the only supported method, so go straight to the key prompt.
    // A browser flow was assessed and dropped for now: it would need a
    // server-side device-authorization or CLI-callback surface that does not
    // exist yet, and a permanently disabled menu entry helps nobody.
    await runCommand(() =>
      loginWithApiKey({
        profile: args.profile,
        org: args.org,
        withToken: args["with-token"],
        json: args.json,
      }),
    );
  },
});
