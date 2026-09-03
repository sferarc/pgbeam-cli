import { defineCommand } from "citty";
import { consola } from "consola";
import { globalArgs } from "../lib/flags.js";
import { removeProjectLink } from "../lib/project.js";

export default defineCommand({
  meta: {
    name: "unlink",
    description: "Remove project link from current directory",
    docs: {
      longDescription:
        "Remove the project link from the current directory by deleting the `.pgbeam` configuration file. After unlinking, commands that require a project will need the `--project` flag or a new `pgbeam link`.",
      examples: [{ comment: "Unlink the current directory", command: "pgbeam unlink" }],
      response:
        "Prints a success message if a link was removed, or a warning if no project was linked.",
    },
  },
  args: {
    ...globalArgs,
  },
  async run() {
    if (removeProjectLink()) {
      consola.success("Project unlinked.");
    } else {
      consola.warn("No project linked in current directory.");
    }
  },
});
