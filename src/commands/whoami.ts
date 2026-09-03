import { defineCommand } from "citty";
import statusCommand from "./auth/status.js";

/**
 * `pgbeam whoami` runs the same implementation as `pgbeam auth status`, but is
 * registered under its own meta.name so `pgbeam whoami --help` shows "whoami"
 * instead of the alias target's name.
 */
export default defineCommand({
  meta: {
    name: "whoami",
    description: "Show current authentication status",
    docs: {
      longDescription:
        "Alias for `pgbeam auth status`. Displays the credential the CLI would use (masked), where it came from, the authentication method, organization, and email, verifying the credential live against the API when reachable.",
      examples: [
        { comment: "Check who you are authenticated as", command: "pgbeam whoami" },
        { comment: "Get auth status as JSON for scripting", command: "pgbeam whoami --json" },
      ],
      response:
        "Same output as `pgbeam auth status`: profile or credential source, method, masked key, email, organization, and live verification result.",
    },
  },
  args: statusCommand.args,
  run: statusCommand.run,
});
