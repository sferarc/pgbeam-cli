import { defineCommand } from "citty";
import { consola } from "consola";
import { requireArg } from "../../lib/args.js";
import { requireProject, resolveContext } from "../../lib/client.js";
import { confirmDestructive } from "../../lib/confirm.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";

export default defineCommand({
  meta: {
    name: "delete",
    description: "Delete a webhook endpoint",
    docs: {
      longDescription:
        "Delete a webhook endpoint from the linked project. PgBeam stops delivering events to it immediately. This action cannot be undone. A confirmation prompt is shown unless `--yes` is passed.",
      examples: [
        {
          comment: "Delete a webhook (with confirmation)",
          command: "pgbeam webhooks delete wh_xxx",
        },
        { comment: "Delete without confirmation", command: "pgbeam webhooks delete wh_xxx --yes" },
      ],
      response: "Prints a success message confirming the webhook was deleted.",
    },
  },
  args: {
    ...globalArgs,
    id: {
      type: "positional",
      description: "ID of the webhook endpoint to delete",
      required: true,
    },
    yes: {
      type: "boolean",
      alias: "y",
      description: "Skip the confirmation prompt",
      default: false,
    },
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);
      const projectId = requireProject(ctx);
      const webhookId = requireArg(args.id, "webhook ID");

      await confirmDestructive({
        yes: args.yes,
        action: "Delete",
        message: `Delete webhook ${webhookId}? This cannot be undone.`,
      });

      await ctx.client.webhooks.deleteWebhookEndpoint({
        pathParams: { project_id: projectId, webhook_id: webhookId },
      });

      consola.success(`Webhook ${webhookId} deleted.`);
    });
  },
});
