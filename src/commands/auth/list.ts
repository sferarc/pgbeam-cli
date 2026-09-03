import { defineCommand } from "citty";
import { consola } from "consola";
import { listProfiles } from "../../lib/config.js";
import { globalArgs } from "../../lib/flags.js";
import { output, outputTable } from "../../lib/output.js";

export default defineCommand({
  meta: {
    name: "list",
    description: "List authentication profiles",
    docs: {
      longDescription:
        "List all saved authentication profiles with their method, organization, and email. The currently active profile is marked with an asterisk (`*`). If no profiles are configured, prints instructions to run `pgbeam auth login`.",
      examples: [
        { comment: "List all profiles", command: "pgbeam auth list" },
        { comment: "List profiles as JSON", command: "pgbeam auth list --json" },
      ],
      response:
        "Displays a table with columns: active indicator, profile name, auth method, organization ID, and email. With `--json`, returns an array of profile objects.",
    },
  },
  args: {
    ...globalArgs,
  },
  async run({ args }) {
    const profiles = listProfiles();

    if (profiles.length === 0) {
      output([], args.json, () => {
        consola.info("No profiles configured. Run `pgbeam auth login` to get started.");
      });
      return;
    }

    output(profiles, args.json, () => {
      outputTable(
        profiles.map((p) => ({
          active: p.active ? "*" : "",
          name: p.name,
          method: p.profile.method,
          org: p.profile.orgId ?? "-",
          email: p.profile.email ?? "-",
        })),
        [
          { key: "active", label: "" },
          { key: "name", label: "Profile" },
          { key: "method", label: "Method" },
          { key: "org", label: "Org" },
          { key: "email", label: "Email" },
        ],
      );
    });
  },
});
