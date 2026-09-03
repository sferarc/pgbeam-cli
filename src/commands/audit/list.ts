import { defineCommand } from "citty";
import { parseNumber } from "../../lib/args.js";
import { requireProject, resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";
import { formatDate, output, outputTable } from "../../lib/output.js";

export default defineCommand({
  meta: {
    name: "list",
    description: "List agent audit log entries",
    docs: {
      longDescription:
        "List agent statement audit entries for the linked project, newest first. Filter by credential or event type (e.g. blocked) to focus on policy violations.",
      examples: [
        { comment: "Recent audit entries", command: "pgbeam audit list" },
        { comment: "Only blocked statements", command: "pgbeam audit list --event blocked" },
        {
          comment: "Entries for one credential",
          command: "pgbeam audit list --credential agt_xxx",
        },
      ],
      response: "Displays a table with columns: Time, Event, Kind, Rule, and SQL.",
    },
  },
  args: {
    ...globalArgs,
    credential: { type: "string", description: "Filter to one agent credential ID" },
    event: { type: "string", description: "Filter to one event type (e.g. blocked)" },
    limit: { type: "string", description: "Maximum entries to return (default 20)" },
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);
      const projectId = requireProject(ctx);

      const queryParams: Record<string, string | number> = {};
      if (args.credential) queryParams.credential_id = args.credential;
      if (args.event) queryParams.event = args.event;
      if (args.limit) queryParams.page_size = parseNumber(args.limit, "limit");

      const result = await ctx.client.agents.listAuditLogs({
        pathParams: { project_id: projectId },
        queryParams,
      });

      output(result, args.json, () => {
        outputTable(
          result.entries.map((e) => ({
            time: formatDate(e.ts),
            event: e.event,
            kind: e.statement_kind ?? "",
            rule: e.decision_rule ?? "",
            sql: e.sql ?? "",
          })),
          [
            { key: "time", label: "Time" },
            { key: "event", label: "Event" },
            { key: "kind", label: "Kind" },
            { key: "rule", label: "Rule" },
            { key: "sql", label: "SQL" },
          ],
        );
      });
    });
  },
});
