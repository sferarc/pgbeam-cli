import { defineCommand } from "citty";
import { consola } from "consola";
import { requireProject, resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";

export default defineCommand({
  meta: {
    name: "reject",
    description: "Reject a held statement",
    docs: {
      longDescription:
        "Reject a held statement approval request by ID. The statement is denied and will not execute. Optionally attach a reason recorded in the audit trail.",
      examples: [
        { comment: "Reject a statement", command: "pgbeam approvals reject apr_xxx" },
        {
          comment: "Reject with a reason",
          command: 'pgbeam approvals reject apr_xxx --reason "writes to prod"',
        },
      ],
      response: "Confirms the statement was rejected.",
    },
  },
  args: {
    ...globalArgs,
    id: { type: "positional", description: "Approval request ID", required: true },
    reason: { type: "string", description: "Reason recorded in the audit trail" },
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);
      const projectId = requireProject(ctx);

      const reason = args.reason;
      await ctx.client.approvals.rejectApprovalRequest({
        pathParams: { project_id: projectId, approval_id: args.id },
        body: reason ? { reason } : {},
      });
      consola.success(`Statement ${args.id} rejected.`);
    });
  },
});
