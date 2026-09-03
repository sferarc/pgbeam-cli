import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { confirm } from "@inquirer/prompts";
import { defineCommand } from "citty";
import { consola } from "consola";
import { requireProject, resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";

export default defineCommand({
  meta: {
    name: "pull",
    description: "Write DATABASE_URL template to .env",
    docs: {
      longDescription:
        "Write a `DATABASE_URL` connection string template to a `.env` file (or a custom file via `--file`). The URL points to the project's PgBeam proxy host. You'll need to replace `USER`, `PASS`, and `YOUR_DB` with your actual upstream database credentials. If the file already contains a `DATABASE_URL`, you'll be prompted before overwriting unless `--yes` is passed.",
      examples: [
        { comment: "Write DATABASE_URL to .env", command: "pgbeam env pull" },
        { comment: "Write to a custom file", command: "pgbeam env pull --file .env.local" },
        {
          comment: "Overwrite existing DATABASE_URL without confirmation",
          command: "pgbeam env pull --yes",
        },
      ],
      response:
        "Prints a success message confirming the file was written and reminds you to replace the placeholder credentials (USER, PASS, YOUR_DB).",
    },
  },
  args: {
    ...globalArgs,
    file: {
      type: "string",
      description: "Path to the output file",
      default: ".env",
    },
    yes: {
      type: "boolean",
      alias: "y",
      description: "Skip the confirmation prompt if the file already contains DATABASE_URL",
      default: false,
    },
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);
      const projectId = requireProject(ctx);

      const project = await ctx.client.projects.getProject({
        pathParams: { project_id: projectId },
      });

      // Build the connection string from the API-provided proxy host
      const proxyHost = project.proxy_host;
      if (!proxyHost) {
        consola.error("Project has no proxy host configured.");
        process.exit(1);
      }
      const databaseUrl = `postgresql://USER:PASS@${proxyHost}:5432/YOUR_DB`;

      const file = args.file;
      let content = "";

      if (existsSync(file)) {
        content = readFileSync(file, "utf-8");
        if (content.includes("DATABASE_URL=")) {
          if (!args.yes) {
            const ok = await confirm({
              message: `${file} already contains DATABASE_URL. Overwrite?`,
              default: false,
            });
            if (!ok) {
              consola.info("Cancelled.");
              return;
            }
          }
          content = content.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL="${databaseUrl}"`);
        } else {
          content = `${content.trimEnd()}\nDATABASE_URL="${databaseUrl}"\n`;
        }
      } else {
        content = `DATABASE_URL="${databaseUrl}"\n`;
      }

      writeFileSync(file, content);
      consola.success(`Wrote DATABASE_URL to ${file}`);
      consola.info("Replace USER, PASS, and YOUR_DB with your upstream credentials.");
    });
  },
});
