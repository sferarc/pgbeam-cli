import { input, select } from "@inquirer/prompts";
import { defineCommand } from "citty";
import { consola } from "consola";
import { optionalArg } from "../../lib/args.js";
import { resolveAuthState } from "../../lib/client.js";
import { loadAuthConfig, saveAuthConfig } from "../../lib/config.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";
import { errorStatus, fetchOrganizations, ORG_ID_DASHBOARD_HINT } from "../../lib/orgs.js";

export default defineCommand({
  meta: {
    name: "switch",
    description: "Switch active organization",
    docs: {
      longDescription:
        "Switch the active organization for the current authentication profile. All subsequent commands that require an organization will use this org. If no org ID is provided, your organizations are fetched from the API and you pick one interactively (a single visible organization is selected automatically). When the API is unreachable, you are prompted to enter an ID by hand; copy it from the dashboard under Settings > Organization.",
      examples: [
        { comment: "Pick from your organizations interactively", command: "pgbeam orgs switch" },
        { comment: "Switch to a specific organization", command: "pgbeam orgs switch org_xxx" },
      ],
      response: "Prints a confirmation message (e.g. `Switched to organization org_xxx.`).",
    },
  },
  args: {
    ...globalArgs,
    id: {
      type: "positional",
      description: "Organization ID to switch to. If omitted, you pick from a list.",
      required: false,
    },
  },
  async run({ args }) {
    await runCommand(async () => {
      const config = loadAuthConfig();
      const profileName = args.profile ?? config.currentProfile;

      if (!profileName || !config.profiles[profileName]) {
        consola.error("Not authenticated. Run `pgbeam auth login` first.");
        process.exit(1);
      }

      let orgId = optionalArg(args.id);

      if (!orgId) {
        // No ID given: list the credential's organizations and pick one.
        const token = resolveAuthState(args).token ?? config.profiles[profileName].token;
        try {
          const orgs = await fetchOrganizations(token);
          if (orgs.length === 0) {
            consola.error(
              `No organizations are visible to this credential. ${ORG_ID_DASHBOARD_HINT}`,
            );
            process.exit(1);
          }
          if (orgs.length === 1) {
            orgId = orgs[0].id;
            consola.info(`Only one organization is visible: ${orgs[0].name} (${orgId}).`);
          } else {
            orgId = await select({
              message: "Select an organization:",
              choices: orgs.map((o) => ({ name: `${o.name} (${o.id})`, value: o.id })),
            });
          }
        } catch (err) {
          // HTTP errors (401 invalid key, ...) surface with remediation hints.
          if (errorStatus(err) !== null) throw err;
          consola.warn(`Could not fetch organizations from the API. ${ORG_ID_DASHBOARD_HINT}`);
          orgId = await input({ message: "Organization ID:" });
        }
      }

      if (!orgId?.trim()) {
        consola.error("Organization ID cannot be empty.");
        process.exit(1);
      }

      config.profiles[profileName].orgId = orgId;
      saveAuthConfig(config);

      consola.success(`Switched to organization ${orgId}.`);
    });
  },
});
