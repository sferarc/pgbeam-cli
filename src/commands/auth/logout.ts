import { confirm } from "@inquirer/prompts";
import { defineCommand } from "citty";
import { consola } from "consola";
import { loadAuthConfig, removeProfile, saveAuthConfig } from "../../lib/config.js";
import { globalArgs } from "../../lib/flags.js";

export default defineCommand({
  meta: {
    name: "logout",
    description: "Remove authentication profile",
    docs: {
      longDescription:
        "Remove stored authentication credentials. By default, removes the currently active profile (or the one specified with `--profile`). Use `--all` to remove every saved profile at once. A confirmation prompt is shown before deletion unless `--yes` is passed.",
      examples: [
        { comment: "Remove the active profile", command: "pgbeam auth logout" },
        { comment: "Remove a specific profile", command: "pgbeam auth logout --profile staging" },
        {
          comment: "Remove all profiles without confirmation",
          command: "pgbeam auth logout --all --yes",
        },
      ],
      response:
        'Prints a success message confirming which profile was removed (e.g. `Profile "default" removed.`). If `--all` is used, confirms all profiles were removed.',
    },
  },
  args: {
    ...globalArgs,
    all: {
      type: "boolean",
      description: "Remove all saved profiles instead of just the active one",
      default: false,
    },
    yes: {
      type: "boolean",
      alias: "y",
      description: "Skip the confirmation prompt",
      default: false,
    },
  },
  async run({ args }) {
    if (args.all) {
      if (!args.yes) {
        const ok = await confirm({
          message: "Remove all authentication profiles?",
          default: false,
        });
        if (!ok) {
          consola.info("Cancelled.");
          return;
        }
      }
      saveAuthConfig({ currentProfile: "", profiles: {} });
      consola.success("All profiles removed.");
      return;
    }

    const config = loadAuthConfig();
    const name = args.profile ?? config.currentProfile;

    if (!name || !config.profiles[name]) {
      consola.error("No profile to remove.");
      process.exit(1);
    }

    removeProfile(name);
    consola.success(`Profile "${name}" removed.`);
  },
});
