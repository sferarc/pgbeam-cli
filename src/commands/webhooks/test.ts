import { defineCommand } from "citty";
import { consola } from "consola";
import { requireArg } from "../../lib/args.js";
import { requireProject, resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";
import { output } from "../../lib/output.js";

export default defineCommand({
  meta: {
    name: "test",
    description: "Send a test delivery to a webhook endpoint",
    docs: {
      longDescription:
        "Trigger a test delivery to a webhook endpoint to verify its URL, format, and signing secret are configured correctly. PgBeam sends a sample payload and reports the result.",
      examples: [
        { comment: "Send a test delivery", command: "pgbeam webhooks test wh_xxx" },
        {
          comment: "Send a test delivery and get the result as JSON",
          command: "pgbeam webhooks test wh_xxx --json",
        },
      ],
      response:
        "Prints a success message confirming the test delivery was sent. With `--json`, returns the test result from the API.",
    },
  },
  args: {
    ...globalArgs,
    id: {
      type: "positional",
      description: "ID of the webhook endpoint to test",
      required: true,
    },
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);
      const projectId = requireProject(ctx);
      const webhookId = requireArg(args.id, "webhook ID");

      const result = await ctx.client.webhooks.testWebhookEndpoint({
        pathParams: { project_id: projectId, webhook_id: webhookId },
      });

      output(result, args.json, () => {
        consola.success(`Test delivery sent to webhook ${webhookId}.`);
      });
    });
  },
});
