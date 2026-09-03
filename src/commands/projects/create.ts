import { input, password, select } from "@inquirer/prompts";
import { defineCommand } from "citty";
import { consola } from "consola";
import { parseEnum, parseNumber, sslModes } from "../../lib/args.js";
import { requireOrg, resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";
import { output } from "../../lib/output.js";

export default defineCommand({
  meta: {
    name: "create",
    description: "Create a new project",
    docs: {
      longDescription:
        "Create a new PgBeam project in your organization. A project groups one or more database connections under a single proxy endpoint. Without flags, the command runs interactively and prompts for all required values including the upstream database connection details and SSL mode.",
      examples: [
        { comment: "Interactive project creation", command: "pgbeam projects create" },
        {
          comment: "Create with all flags (non-interactive)",
          command:
            "pgbeam projects create --name my-app --host db.example.com --port 5432 --database mydb --username admin --password secret --ssl-mode require",
        },
        {
          comment: "Create and capture the project ID for scripting",
          command:
            "PROJECT_ID=$(pgbeam projects create --name my-app --host db.example.com --database mydb --username admin --password secret --json | jq -r '.project.id')",
        },
      ],
      response:
        "Prints the new project ID, name, and database host. Suggests running `pgbeam link` as a next step. With `--json`, returns the full project and database objects.",
    },
  },
  args: {
    ...globalArgs,
    name: {
      type: "string",
      description: "Display name for the project",
    },
    host: {
      type: "string",
      description: "Hostname or IP address of the upstream PostgreSQL server",
    },
    port: {
      type: "string",
      description: "Port number of the upstream PostgreSQL server",
      default: "5432",
    },
    database: {
      type: "string",
      description: "Name of the database on the upstream server",
    },
    username: {
      type: "string",
      description: "Username for authenticating with the upstream database",
    },
    password: {
      type: "string",
      description: "Password for authenticating with the upstream database",
    },
    "ssl-mode": {
      type: "string",
      description: "SSL connection mode: disable, require, verify-ca, or verify-full",
    },
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);
      const orgId = requireOrg(ctx);

      const name = args.name ?? (await input({ message: "Project name:" }));
      const host = args.host ?? (await input({ message: "Database host:" }));
      const port = parseNumber(args.port, "port");
      const database = args.database ?? (await input({ message: "Database name:" }));
      const username = args.username ?? (await input({ message: "Database username:" }));
      const dbPassword =
        args.password ??
        (await password({
          message: "Database password:",
          mask: "*",
        }));

      const sslMode = args["ssl-mode"]
        ? parseEnum(args["ssl-mode"], sslModes, "ssl-mode")
        : await select({
            message: "SSL mode:",
            choices: [
              { name: "require", value: sslModes.require },
              { name: "verify-full", value: sslModes["verify-full"] },
              { name: "disable", value: sslModes.disable },
            ],
          });

      const result = await ctx.client.projects.createProject({
        body: {
          name,
          org_id: orgId,
          database: {
            host,
            port,
            name: database,
            username,
            password: dbPassword,
            ssl_mode: sslMode,
          },
        },
      });

      output(result, args.json, () => {
        consola.success(`Project created: ${result.project.id}`);
        consola.log(`  Name: ${result.project.name}`);
        if (result.database) {
          consola.log(`  Database: ${result.database.host}:${result.database.port}`);
        }
        consola.info("Next: pgbeam link to link this project to your directory.");
      });
    });
  },
});
