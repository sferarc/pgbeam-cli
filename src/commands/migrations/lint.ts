import { readFile } from "node:fs/promises";
import { defineCommand } from "citty";
import { consola } from "consola";
import { optionalArg } from "../../lib/args.js";
import { requireProject, resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";
import { output } from "../../lib/output.js";

const STATEMENT_MAX = 80;

export default defineCommand({
  meta: {
    name: "lint",
    description: "Lint a migration for unsafe DDL",
    docs: {
      longDescription:
        "Lint migration SQL for unsafe DDL patterns before applying it. Detects operations that can lock tables, break replication, or cause downtime (such as adding NOT NULL columns without a default, dropping columns, or rewriting large tables) and reports findings with severity, the offending statement, and a remediation hint. Provide SQL inline as an argument or from a file with --file.",
      examples: [
        {
          comment: "Lint inline SQL",
          command: 'pgbeam migrations lint "ALTER TABLE users ADD COLUMN age int NOT NULL;"',
        },
        { comment: "Lint a migration file", command: "pgbeam migrations lint --file ./0001.sql" },
        {
          comment: "Lint against a specific database",
          command: "pgbeam migrations lint --file ./0001.sql --database db_xxx",
        },
        {
          comment: "Get findings as JSON",
          command: "pgbeam migrations lint --file ./0001.sql --json",
        },
      ],
      response:
        "Prints whether the migration is safe and lists any findings with their severity, rule, message, hint, and offending statement. With `--json`, returns an object with `safe` and `findings`.",
    },
  },
  args: {
    ...globalArgs,
    sql: { type: "positional", description: "Inline SQL to lint", required: false },
    file: { type: "string", description: "Path to a .sql file to lint" },
    database: { type: "string", description: "Database ID to scope the lint to" },
  },
  async run({ args }) {
    await runCommand(async () => {
      // Read the SQL input before auth resolution, so a missing --file reports
      // itself rather than an unrelated "Not authenticated" error.
      const file = optionalArg(args.file);
      const databaseId = optionalArg(args.database);

      let sql: string;
      if (file) {
        sql = await readFile(file, "utf8");
      } else {
        sql = optionalArg(args.sql) ?? "";
      }
      sql = sql.trim();

      if (!sql) {
        throw new Error("Provide SQL as an argument or via --file");
      }

      const ctx = resolveContext(args);
      const projectId = requireProject(ctx);

      const result = await ctx.client.migrations.lintMigration({
        pathParams: { project_id: projectId },
        body: { sql, ...(databaseId ? { database_id: databaseId } : {}) },
      });

      output(result, args.json, () => {
        if (result.safe && result.findings.length === 0) {
          consola.success("Migration is safe, no blocking findings.");
          return;
        }

        if (result.safe) {
          consola.success("Migration is safe, no blocking findings.");
        } else {
          consola.warn("Migration has findings:");
        }

        for (const finding of result.findings) {
          consola.log(`  [${finding.severity}] ${finding.rule}: ${finding.message}`);
          if (finding.hint) {
            consola.log(`       hint: ${finding.hint}`);
          }
          if (finding.statement) {
            const stmt = finding.statement.trim().replace(/\s+/g, " ");
            const truncated =
              stmt.length > STATEMENT_MAX ? `${stmt.slice(0, STATEMENT_MAX)}…` : stmt;
            consola.log(`       statement: ${truncated}`);
          }
        }
      });
    });
  },
});
