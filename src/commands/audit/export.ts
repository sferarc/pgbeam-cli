import { writeFileSync } from "node:fs";
import { defineCommand } from "citty";
import { consola } from "consola";
import { parseEnum } from "../../lib/args.js";
import { requireProject, resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";

const auditDecisions = {
  allow: "allow",
  block: "block",
  mask: "mask",
  truncate: "truncate",
} as const;
const auditSources = { wire: "wire", mcp: "mcp", rest: "rest", control: "control" } as const;

export default defineCommand({
  meta: {
    name: "export",
    description: "Export agent audit logs as CSV",
    docs: {
      longDescription:
        "Stream the linked project's agent audit entries as a CSV file, newest first, honoring the same credential, event, decision, source, and date-range filters as `audit list`. The full filtered set is streamed (no pagination), suitable for spreadsheets, SIEM ingestion, and compliance archives. Writes to stdout by default, or to a file with `--output`. The API emits CSV only; the wire/mcp/rest/control-formatted views are selected with `--source`, not a separate output format.",
      examples: [
        { comment: "Export all audit entries to stdout", command: "pgbeam audit export" },
        {
          comment: "Export blocked statements to a file",
          command: "pgbeam audit export --event blocked --output audit.csv",
        },
        {
          comment: "Export MCP-sourced entries in a date range",
          command:
            "pgbeam audit export --source mcp --start 2026-01-01T00:00:00Z --end 2026-02-01T00:00:00Z --output jan.csv",
        },
        {
          comment: "Export a single credential's masked events",
          command: "pgbeam audit export --credential agt_xxx --decision mask",
        },
      ],
      response:
        "Writes CSV to stdout, or to the file named by --output (with a confirmation message). Columns include id, ts, event, source, credential_id, decision_rule, sql, and more.",
    },
  },
  args: {
    ...globalArgs,
    credential: { type: "string", description: "Filter to one agent credential ID" },
    event: {
      type: "string",
      description: "Filter to one event type (e.g. blocked, masked, query)",
    },
    decision: {
      type: "string",
      description: "Coarse outcome filter: allow, block, mask, or truncate",
    },
    source: {
      type: "string",
      description: "Filter by statement origin: wire, mcp, rest, or control",
    },
    start: {
      type: "string",
      description: "Return entries at or after this ISO 8601 timestamp (inclusive lower bound)",
    },
    end: {
      type: "string",
      description: "Return entries strictly older than this ISO 8601 timestamp (upper bound)",
    },
    output: {
      type: "string",
      alias: "o",
      description: "Write the CSV to this file instead of stdout",
    },
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);
      const projectId = requireProject(ctx);

      const queryParams: Record<string, string> = {};
      if (args.credential) queryParams.credential_id = args.credential;
      if (args.event) queryParams.event = args.event;
      if (args.decision) {
        queryParams.decision = parseEnum(args.decision, auditDecisions, "decision");
      }
      if (args.source) queryParams.source = parseEnum(args.source, auditSources, "source");
      if (args.start) queryParams.start = args.start;
      if (args.end) queryParams.end = args.end;

      const csv =
        (await ctx.client.agents.exportAuditLogs({
          pathParams: { project_id: projectId },
          queryParams,
        })) ?? "";

      if (args.output) {
        writeFileSync(args.output, csv);
        consola.success(`Audit log exported to ${args.output}.`);
      } else {
        process.stdout.write(csv.endsWith("\n") ? csv : `${csv}\n`);
      }
    });
  },
});
