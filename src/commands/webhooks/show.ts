import { defineCommand } from "citty";
import { consola } from "consola";
import { requireArg } from "../../lib/args.js";
import { requireProject, resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";
import { formatDate, output } from "../../lib/output.js";

export default defineCommand({
  meta: {
    name: "show",
    description: "Show a webhook endpoint",
    docs: {
      longDescription:
        "Display the full configuration of a single webhook endpoint, including its URL, delivery format, subscribed event types, enabled state, description, and timestamps.",
      examples: [
        { comment: "Show a webhook endpoint", command: "pgbeam webhooks show wh_xxx" },
        {
          comment: "Show a webhook endpoint as JSON",
          command: "pgbeam webhooks show wh_xxx --json",
        },
      ],
      response:
        "Prints each field of the webhook endpoint on its own line. With `--json`, returns the full webhook object from the API.",
    },
  },
  args: {
    ...globalArgs,
    id: {
      type: "positional",
      description: "ID of the webhook endpoint to show",
      required: true,
    },
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);
      const projectId = requireProject(ctx);
      const webhookId = requireArg(args.id, "webhook ID");

      const result = await ctx.client.webhooks.getWebhookEndpoint({
        pathParams: { project_id: projectId, webhook_id: webhookId },
      });

      output(result, args.json, () => {
        consola.log(`ID:          ${result.id}`);
        consola.log(`Project:     ${result.project_id}`);
        consola.log(`URL:         ${result.url}`);
        consola.log(`Format:      ${result.format}`);
        consola.log(
          `Events:      ${
            result.event_types && result.event_types.length > 0
              ? result.event_types.join(", ")
              : "all"
          }`,
        );
        consola.log(`Enabled:     ${result.enabled ? "yes" : "no"}`);
        consola.log(`Description: ${result.description ?? "-"}`);
        consola.log(`Created:     ${formatDate(result.created_at)}`);
        consola.log(`Updated:     ${formatDate(result.updated_at)}`);
      });
    });
  },
});
