import { defineCommand, runMain } from "citty";
import { consola } from "consola";
import { VERSION } from "./lib/constants.js";
import { globalArgs } from "./lib/flags.js";
import { showUsageWithExamples } from "./lib/help.js";
import { checkForUpdates } from "./lib/upgrade-notifier.js";
import { subCommands } from "./tree.js";

const main = defineCommand({
  meta: {
    name: "pgbeam",
    version: VERSION,
    description: "PgBeam CLI, manage your PostgreSQL proxy platform",
  },
  args: {
    ...globalArgs,
  },
  setup({ args }) {
    if (args["no-color"]) process.env.NO_COLOR = "1";
    if (args.debug) consola.level = 5;
  },
  subCommands,
});

// Check for updates in the background (non-blocking, silent on failure)
checkForUpdates().catch(() => {});

runMain(main, { showUsage: showUsageWithExamples });
