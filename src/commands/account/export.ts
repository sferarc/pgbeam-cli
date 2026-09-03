import { writeFileSync } from "node:fs";
import { defineCommand } from "citty";
import { consola } from "consola";
import { resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";
import { formatDate, output } from "../../lib/output.js";

export default defineCommand({
  meta: {
    name: "export",
    description: "Export account data (GDPR/CCPA)",
    docs: {
      longDescription:
        "Export all account data as required by GDPR and CCPA regulations. Includes your user profile, organizations, projects, databases, active sessions, and audit logs. Use `--file` to write the full export to a JSON file, or `--json` to print the full export to stdout.",
      examples: [
        { comment: "Show a summary of your account data", command: "pgbeam account export" },
        {
          comment: "Export full data to a file",
          command: "pgbeam account export --file account-export.json",
        },
        { comment: "Export full data as JSON to stdout", command: "pgbeam account export --json" },
      ],
      response:
        "Without `--file` or `--json`, displays a summary showing counts of organizations, projects, databases, sessions, and audit logs. With `--file`, writes the full JSON export to the specified path. With `--json`, outputs the complete export object.",
    },
  },
  args: {
    ...globalArgs,
    file: {
      type: "string",
      description:
        "Write the full export to a JSON file at this path instead of printing to stdout",
    },
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);

      const result = await ctx.client.account.exportAccountData();

      if (args.file) {
        writeFileSync(args.file, JSON.stringify(result, null, 2));
        consola.success(`Account data exported to ${args.file}`);
        return;
      }

      output(result, args.json, () => {
        consola.log(`User:          ${result.user.name} (${result.user.email})`);
        consola.log(`Organizations: ${result.organizations.length}`);
        consola.log(`Projects:      ${result.projects.length}`);
        consola.log(`Databases:     ${result.databases.length}`);
        consola.log(`Sessions:      ${result.sessions.length}`);
        consola.log(`Audit logs:    ${result.audit_logs.length}`);
        consola.log(`Exported at:   ${formatDate(result.exported_at)}`);
        consola.info("\nUse --json or --file to get the full export.");
      });
    });
  },
});
