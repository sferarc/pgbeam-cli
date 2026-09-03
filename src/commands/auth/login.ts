import { defineCommand } from "citty";
import { loginWithApiKey } from "../../lib/auth.js";
import { globalArgs } from "../../lib/flags.js";

export default defineCommand({
  meta: {
    name: "login",
    description: "Authenticate with PgBeam",
    docs: {
      longDescription:
        "Authenticate with PgBeam to access your projects and databases. Login uses an API key, which you generate from the PgBeam dashboard under Settings > API Keys; running the command prompts you to paste it. The key is verified against the API before it is stored (an invalid key fails the login), and your organization is resolved automatically: a single visible organization is selected for you, multiple organizations prompt a pick. Credentials are stored in a local profile on disk (`~/.config/pgbeam/`). You can maintain multiple profiles for different environments using the `--profile` flag.",
      examples: [
        { comment: "Login with an API key (prompts for the key)", command: "pgbeam auth login" },
        {
          comment: "Login with an API key and save to a named profile",
          command: "pgbeam auth login --profile production",
        },
      ],
      response:
        "On success, prints a confirmation with the authenticated profile name and the selected organization, ready for `pgbeam projects list`. The token is stored locally and used for all subsequent commands. A key the API rejects (401) is not stored and the command exits non-zero.",
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
  },
  async run({ args }) {
    // API key is the only supported method, so go straight to the key prompt.
    // A browser flow was assessed and dropped for now: it would need a
    // server-side device-authorization or CLI-callback surface that does not
    // exist yet, and a permanently disabled menu entry helps nobody.
    await loginWithApiKey(args.profile);
  },
});
