import { select } from "@inquirer/prompts";
import { defineCommand } from "citty";
import { consola } from "consola";
import { listProfiles, switchProfile } from "../../lib/config.js";
import { globalArgs } from "../../lib/flags.js";

export default defineCommand({
  meta: {
    name: "switch",
    description: "Switch active authentication profile",
    docs: {
      longDescription:
        "Switch the active authentication profile. If no profile name is provided, an interactive selector is shown listing all available profiles. The active profile determines which API token and organization are used for subsequent commands.",
      examples: [
        { comment: "Interactive profile selection", command: "pgbeam auth switch" },
        {
          comment: "Switch to a specific profile by name",
          command: "pgbeam auth switch production",
        },
      ],
      response:
        'Prints a confirmation message (e.g. `Switched to profile "production".`). If the profile is not found, exits with an error.',
    },
  },
  args: {
    ...globalArgs,
    name: {
      type: "positional",
      description:
        "Name of the profile to switch to. If omitted, an interactive selector is shown.",
      required: false,
    },
  },
  async run({ args }) {
    let name = typeof args.name === "string" ? args.name : undefined;

    if (!name) {
      const profiles = listProfiles();
      if (profiles.length === 0) {
        consola.error("No profiles configured. Run `pgbeam auth login` first.");
        return;
      }
      name = await select({
        message: "Select profile:",
        choices: profiles.map((p) => ({
          name: `${p.name}${p.active ? " (active)" : ""} — ${p.profile.method}`,
          value: p.name,
        })),
      });
    }

    if (switchProfile(name)) {
      consola.success(`Switched to profile "${name}".`);
    } else {
      consola.error(`Profile "${name}" not found.`);
      process.exit(1);
    }
  },
});
