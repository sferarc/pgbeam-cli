import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { defineCommand } from "citty";
import { consola } from "consola";
import { requireProject, resolveContext } from "../../lib/client.js";
import { confirmDestructive } from "../../lib/confirm.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";

// Matches `DATABASE_URL=`, `export DATABASE_URL=` and `DATABASE_URL = `, but not
// other keys that merely end in DATABASE_URL.
const DATABASE_URL_LINE = /^([ \t]*(?:export[ \t]+)?)DATABASE_URL[ \t]*=.*$/gm;

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
      const line = `DATABASE_URL="${databaseUrl}"`;
      const existing = existsSync(file) ? readFileSync(file, "utf-8") : undefined;
      let content: string;

      const matches = existing?.match(DATABASE_URL_LINE)?.length ?? 0;
      if (existing === undefined) {
        content = `${line}\n`;
      } else if (matches === 0) {
        content = existing.trim() === "" ? `${line}\n` : `${existing.trimEnd()}\n${line}\n`;
      } else {
        await confirmDestructive({
          yes: args.yes,
          message: `${file} already contains DATABASE_URL. Overwrite?`,
          action: "Overwriting DATABASE_URL",
        });
        if (matches > 1) {
          consola.warn(`${file} had ${matches} DATABASE_URL lines; all of them were replaced.`);
        }
        content = existing.replace(DATABASE_URL_LINE, (_match, prefix: string) => prefix + line);
      }

      // The mode only applies when the file is created; an existing file keeps its own.
      writeFileSync(file, content, { mode: 0o600 });
      consola.success(`Wrote DATABASE_URL to ${file}`);
      consola.info("Replace USER, PASS, and YOUR_DB with your upstream credentials.");
    });
  },
});
