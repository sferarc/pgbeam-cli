import { defineCommand } from "citty";
import { consola } from "consola";
import { requireProject, resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";

export default defineCommand({
  meta: {
    name: "approve",
    description: "Approve a held statement",
    docs: {
      longDescription:
        "Approve a held statement approval request by ID. The statement is released for execution. Optionally attach a reason recorded in the audit trail.",
      examples: [
        { comment: "Approve a statement", command: "pgbeam approvals approve apr_xxx" },
        {
          comment: "Approve with a reason",
          command: 'pgbeam approvals approve apr_xxx --reason "verified safe"',
        },
      ],
      response: "Confirms the statement was approved.",
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
      await ctx.client.approvals.approveApprovalRequest({
        pathParams: { project_id: projectId, approval_id: args.id },
        body: reason ? { reason } : {},
      });
      consola.success(`Statement ${args.id} approved.`);
    });
  },
});
