import { defineCommand } from "citty";
import { consola } from "consola";
import { requireArg } from "../../lib/args.js";
import { requireProject, resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";
import { formatDate, output } from "../../lib/output.js";

/** Render a table list, or a dash when the session touched nothing that way. */
function tableList(names: string[]): string {
  return names.length > 0 ? names.join(", ") : "-";
}

/** One alert on one line: when, how bad, what kind, and where triage stands. */
function alertLine(a: { created_at: string; severity: string; kind: string; status: string }) {
  return `  ${formatDate(a.created_at)}  ${a.severity}  ${a.kind}  (${a.status})`;
}

export default defineCommand({
  meta: {
    name: "session",
    description: "Summarize one agent session's audit entries",
    docs: {
      longDescription:
        "Group one session's audit entries into a single summary: the credentials and origins involved, the window it spans, how many statements were allowed, blocked, masked and truncated, the rows and bytes it moved, and the tables it read, wrote and was refused. Session IDs come from the session_id field of `pgbeam audit list --json`. The summary is computed from the audit log with no model involved, so the same entries always summarize the same way, and it carries table names and counts only, never row values. A session ID is unique per connection within a proxy instance and not over time, so narrow a reused one with --start and --end.",
      examples: [
        { comment: "Summarize a session", command: "pgbeam audit session 0000a41f" },
        {
          comment: "Narrow a reused session ID to one window",
          command:
            "pgbeam audit session 0000a41f --start 2026-01-01T00:00:00Z --end 2026-01-02T00:00:00Z",
        },
        {
          comment: "Machine-readable output",
          command: "pgbeam audit session 0000a41f --json",
        },
      ],
      response:
        "Prints the session window, credentials and sources, the allowed/blocked/masked/truncated statement counts, rows and bytes returned, and the tables read, written, and blocked. When your role holds anomaly:read it also lists the alerts raised from the session's own entries, and separately the rate and shape alerts on its credentials whose window overlaps the session, which are not attributed to the session itself.",
    },
  },
  args: {
    ...globalArgs,
    "session-id": {
      type: "positional",
      description: "Session ID from an audit entry",
      required: true,
    },
    start: {
      type: "string",
      description: "Only entries at or after this ISO 8601 timestamp (inclusive lower bound)",
    },
    end: {
      type: "string",
      description: "Only entries strictly older than this ISO 8601 timestamp (upper bound)",
    },
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);
      const projectId = requireProject(ctx);
      const sessionId = requireArg(args["session-id"], "session-id");

      const queryParams: Record<string, string> = {};
      if (args.start) queryParams.start = args.start;
      if (args.end) queryParams.end = args.end;

      const summary = await ctx.client.agents.getAuditSessionSummary({
        pathParams: { project_id: projectId, session_id: sessionId },
        queryParams,
      });

      output(summary, args.json, () => {
        consola.log(`Session:     ${summary.session_id}`);
        consola.log(
          `Window:      ${formatDate(summary.started_at)} to ${formatDate(summary.ended_at)}`,
        );
        consola.log(`Credentials: ${tableList(summary.credential_ids)}`);
        consola.log(`Sources:     ${tableList(summary.sources)}`);
        consola.log("");
        consola.log(
          `Statements:  ${summary.statements} (${summary.allowed} allowed, ${summary.blocked} blocked, ${summary.masked} masked, ${summary.truncated} truncated)`,
        );
        consola.log(`Returned:    ${summary.rows_returned} rows, ${summary.bytes_out} bytes`);
        consola.log("");
        consola.log(`Read:        ${tableList(summary.tables_read)}`);
        consola.log(`Written:     ${tableList(summary.tables_written)}`);
        consola.log(`Blocked:     ${tableList(summary.tables_blocked)}`);
        consola.log("");

        // Absent means withheld, not none: the caller's role lacks anomaly:read.
        const anomalies = summary.anomalies;
        if (!anomalies) {
          consola.log("Alerts:      not shown (your role does not hold anomaly:read)");
        } else {
          consola.log(`Alerts raised from this session: ${anomalies.session_alerts.length}`);
          for (const a of anomalies.session_alerts) consola.log(alertLine(a));
          consola.log(
            `Rate and shape alerts on its credentials in this window: ${anomalies.credential_window_alerts.length}`,
          );
          for (const a of anomalies.credential_window_alerts) consola.log(alertLine(a));
          // Alert dedup is per credential, so a repeat hit raises nothing new.
          // Point at the entries that are complete rather than let zero read as
          // a clean session.
          consola.log(
            "Alerts are deduplicated per credential, so a repeat hit raises no new alert. The session's canary_tripped and content_flagged audit entries are the complete record.",
          );
          if (anomalies.truncated) {
            consola.warn(
              "More alerts exist than one summary lists. Read the rest with `pgbeam anomalies list`.",
            );
          }
        }

        // Both of these mean the table lists above are incomplete, so say it
        // rather than let a short list read as a quiet session.
        if (summary.unparsed_statements > 0) {
          consola.warn(
            `${summary.unparsed_statements} statement(s) could not be parsed, so their tables are missing from the lists above.`,
          );
        }
        if (summary.scan_truncated) {
          consola.warn(
            "This session has more entries than one summary reads; the counts cover its earliest entries only. Narrow the window with --start and --end.",
          );
        }
      });
    });
  },
});
