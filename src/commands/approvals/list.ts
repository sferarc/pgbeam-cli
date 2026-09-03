import { defineCommand } from "citty";
import type { ApprovalRequestStatusEnumKey } from "pgbeam";
import { requireProject, resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";
import { formatDate, output, outputTable } from "../../lib/output.js";

/** Collapse newlines and truncate SQL for compact table display. */
function truncateSql(sql: string, max = 50): string {
  const flat = sql.replace(/\s*\n\s*/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export default defineCommand({
  meta: {
    name: "list",
    description: "List statement approval requests for a project",
    docs: {
      longDescription:
        "List human-in-the-loop statement approval requests for the linked project. Optionally filter by status. Shows each request's ID, statement kind, status, request time, and a truncated SQL preview.",
      examples: [
        { comment: "List approval requests", command: "pgbeam approvals list" },
        {
          comment: "List only pending requests",
          command: "pgbeam approvals list --status pending",
        },
      ],
      response: "Displays a table with columns: ID, Kind, Status, Requested, and SQL.",
    },
  },
  args: {
    ...globalArgs,
    status: {
      type: "string",
      description:
        "Filter by status (one of: pending, approved, rejected, expired, executed, failed)",
    },
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);
      const projectId = requireProject(ctx);

      const status = args.status as ApprovalRequestStatusEnumKey | undefined;
      const result = await ctx.client.approvals.listApprovalRequests({
        pathParams: { project_id: projectId },
        queryParams: { page_size: 50, ...(status ? { status } : {}) },
      });

      output(result, args.json, () => {
        outputTable(
          result.approvals.map((a) => ({
            id: a.id,
            kind: a.statement_kind ?? "—",
            status: a.status,
            requested: formatDate(a.requested_at),
            sql: truncateSql(a.sql),
          })),
          [
            { key: "id", label: "ID" },
            { key: "kind", label: "Kind" },
            { key: "status", label: "Status" },
            { key: "requested", label: "Requested" },
            { key: "sql", label: "SQL" },
          ],
        );
      });
    });
  },
});
