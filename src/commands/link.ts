import { select } from "@inquirer/prompts";
import { defineCommand } from "citty";
import { consola } from "consola";
import { requireOrg, resolveContext } from "../lib/client.js";
import { runCommand } from "../lib/errors.js";
import { globalArgs } from "../lib/flags.js";
import { saveProjectLink } from "../lib/project.js";

export default defineCommand({
  meta: {
    name: "link",
    description: "Link current directory to a PgBeam project",
    docs: {
      longDescription:
        "Link the current working directory to a PgBeam project by creating a `.pgbeam` configuration file. This saves the project ID so subsequent commands (like `pgbeam db list` or `pgbeam projects inspect`) automatically use the linked project without requiring `--project`. An interactive selector is shown to choose from your organization's projects.",
      examples: [
        { comment: "Link the current directory to a project", command: "pgbeam link" },
        { comment: "Link with a specific organization", command: "pgbeam link --org org_xxx" },
      ],
      response:
        "Prints a success message with the linked project ID and suggests `pgbeam db list` as a next step. A `.pgbeam` file is created in the current directory.",
    },
  },
  args: {
    ...globalArgs,
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);
      const orgId = requireOrg(ctx);

      const projects = await ctx.client.projects.listProjects({
        queryParams: { org_id: orgId },
      });

      if (projects.projects.length === 0) {
        consola.warn("No projects found. Create one with `pgbeam projects create`.");
        return;
      }

      const projectId = await select({
        message: "Select a project to link:",
        choices: projects.projects.map((p) => ({
          name: `${p.name} (${p.id})`,
          value: p.id,
        })),
      });

      saveProjectLink({ projectId, orgId });
      consola.success(`Linked to project ${projectId}.`);
      consola.info("Next: pgbeam db list");
    });
  },
});
