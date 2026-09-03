import { defineCommand } from "citty";
import { consola } from "consola";
import { requireProject, resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";
import { formatDate, output } from "../../lib/output.js";

/** Right-align a number in a fixed column so the table stays readable. */
function num(value: number, width: number): string {
  return String(value).padStart(width);
}

/** Render bytes at whole-unit precision. Usage tables are read, not audited. */
function bytes(value: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = value;
  let unit = 0;
  while (n >= 1024 && unit < units.length - 1) {
    n /= 1024;
    unit++;
  }
  return `${unit === 0 ? n : n.toFixed(1)}${units[unit]}`;
}

export default defineCommand({
  meta: {
    name: "usage",
    description: "Break down project usage by agent credential",
    docs: {
      longDescription:
        "Aggregate the audit trail into per-agent usage for a window: statements by decision, rows and bytes returned, the cache outcome breakdown, and latency percentiles. Without --start and --end the window is the last 30 days, and it cannot exceed 92 days because the report reads every entry in it. Grouped by credential, not by session, because a session ID identifies one connection rather than an agent or a run. Usage recorded against no credential is reported as its own line rather than dropped, so the agent lines plus unattributed always equal the totals. The command reports usage and prices nothing: overage is computed on the organization's total against a plan limit, so no single agent causes it independently of the others. The plan's limits and marginal rates are included in --json output for a caller that wants to apply its own pricing policy.",
      examples: [
        { comment: "Usage for the linked project", command: "pgbeam agents usage" },
        {
          comment: "One window",
          command: "pgbeam agents usage --start 2026-09-01T00:00:00Z --end 2026-09-08T00:00:00Z",
        },
        { comment: "Machine-readable output", command: "pgbeam agents usage --json" },
      ],
      response:
        "Prints one line per agent credential with statement counts by decision, rows and bytes returned, and latency percentiles, followed by the unattributed line and the totals. Warns when the trail lost entries in the window, because the totals are then a floor rather than a measurement.",
    },
  },
  args: {
    ...globalArgs,
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

      const queryParams: Record<string, string> = {};
      if (args.start) queryParams.start = args.start;
      if (args.end) queryParams.end = args.end;

      const report = await ctx.client.agents.getAgentUsageBreakdown({
        pathParams: { project_id: projectId },
        queryParams,
      });

      output(report, args.json, () => {
        consola.log(
          `Requested: ${formatDate(report.requested_start)} to ${formatDate(report.requested_end)}`,
        );
        // The covered window is the data's own first and last entry, which is
        // narrower than the requested one and is what the totals actually span.
        // Printing only the requested window would let an empty month read as a
        // measured month.
        consola.log(
          `Covered:   ${formatDate(report.window_start)} to ${formatDate(report.window_end)}`,
        );
        consola.log("");

        const header = [
          "CREDENTIAL".padEnd(24),
          "ENTRIES".padStart(8),
          "ALLOWED".padStart(8),
          "BLOCKED".padStart(8),
          "MASKED".padStart(7),
          "ROWS".padStart(10),
          "BYTES".padStart(9),
          "P50".padStart(8),
          "P99".padStart(8),
        ].join(" ");
        consola.log(header);

        const line = (label: string, l: (typeof report.agents)[number], showPct: boolean) => {
          consola.log(
            [
              label.slice(0, 24).padEnd(24),
              num(l.entries, 8),
              num(l.allowed, 8),
              num(l.blocked, 8),
              num(l.masked, 7),
              num(l.rows_returned, 10),
              bytes(l.bytes_out).padStart(9),
              (showPct ? `${l.latency_p50_ms.toFixed(1)}ms` : "-").padStart(8),
              (showPct ? `${l.latency_p99_ms.toFixed(1)}ms` : "-").padStart(8),
            ].join(" "),
          );
        };

        for (const agent of report.agents) {
          line(agent.credential_id ?? "-", agent, true);
        }

        // The unattributed line is always printed, including at zero. Its
        // absence would be indistinguishable from a window that had none, and
        // the difference is the point of reporting it.
        line("(unattributed)", report.unattributed, false);
        // Percentiles are not printed on the totals line because an accumulated
        // line does not carry one: the API returns zero there rather than an
        // average, since the mean of two p99s is not the p99 of the union.
        line("(total)", report.totals, false);

        if (report.totals.latency_unmeasured > 0) {
          consola.warn(
            `${report.totals.latency_unmeasured} entr(ies) had a non-finite latency and were excluded from the percentiles.`,
          );
        }

        if (!report.complete) {
          const d = report.drop_markers;
          const unparsed =
            d.markers_unparsed > 0
              ? `, and ${d.markers_unparsed} marker(s) whose count could not be read`
              : "";
          // A truncated marker list makes entries_dropped a floor over a floor,
          // so say the count is partial rather than printing it as exact.
          const markerCount = d.truncated ? `more than ${d.markers}` : `${d.markers}`;
          consola.warn(
            `The audit trail lost entries in this window: ${markerCount} gap marker(s) accounting for at least ${d.entries_dropped} entr(ies)${unparsed}. The totals above are a floor, not a measurement.`,
          );
          for (const reason of d.reasons) {
            consola.log(`  ${reason}`);
          }
        }
      });
    });
  },
});
