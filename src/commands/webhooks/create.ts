import { input } from "@inquirer/prompts";
import { defineCommand } from "citty";
import { consola } from "consola";
import type { WebhookEndpointInput, WebhookEndpointInputFormatEnumKey } from "pgbeam";
import { optionalArg, parseEnum } from "../../lib/args.js";

/** Webhook delivery format enum values matching the SDK type. */
const webhookFormats = {
  json: "json",
  splunk_hec: "splunk_hec",
  datadog: "datadog",
  elastic: "elastic",
} satisfies Record<string, WebhookEndpointInputFormatEnumKey>;

import { requireProject, resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";
import { output } from "../../lib/output.js";

export default defineCommand({
  meta: {
    name: "create",
    description: "Create a webhook endpoint",
    docs: {
      longDescription:
        "Create a webhook endpoint for the linked project. PgBeam delivers event and audit notifications to the given URL using the selected format. Subscribe to specific event types with `--event` (repeatable or comma-separated); omit it to receive all events.",
      examples: [
        { comment: "Create a webhook interactively", command: "pgbeam webhooks create" },
        {
          comment: "Create a webhook for a URL",
          command: "pgbeam webhooks create https://example.com/hook",
        },
        {
          comment: "Create a Datadog webhook for specific events",
          command:
            "pgbeam webhooks create https://example.com/hook --format datadog --event query.blocked,policy.updated",
        },
        {
          comment: "Create a disabled webhook with a secret",
          command: "pgbeam webhooks create https://example.com/hook --secret s3cr3t --disabled",
        },
      ],
      response:
        "Prints a success message with the new webhook ID and its URL. With `--json`, returns the full webhook object from the API.",
    },
  },
  args: {
    ...globalArgs,
    url: {
      type: "positional",
      description: "Destination URL for webhook deliveries. If omitted, you will be prompted.",
      required: false,
    },
    format: {
      type: "string",
      description: "Delivery format: json, splunk_hec, datadog, or elastic.",
      default: "json",
    },
    event: {
      type: "string",
      description: "Event type(s) to subscribe to. Comma-separated. Omit to receive all events.",
    },
    secret: {
      type: "string",
      description: "Shared secret used to sign webhook payloads.",
    },
    description: {
      type: "string",
      description: "Human-readable description for the webhook endpoint.",
    },
    disabled: {
      type: "boolean",
      description: "Create the webhook in a disabled state.",
      default: false,
    },
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);
      const projectId = requireProject(ctx);

      const url = optionalArg(args.url) ?? (await input({ message: "Webhook URL:" }));

      const eventTypes = optionalArg(args.event)
        ?.split(",")
        .map((e) => e.trim())
        .filter((e) => e.length > 0);

      const secret = optionalArg(args.secret);
      const description = optionalArg(args.description);

      const body: WebhookEndpointInput = {
        url,
        format: parseEnum(args.format, webhookFormats, "format"),
        enabled: !args.disabled,
      };
      if (eventTypes && eventTypes.length > 0) body.event_types = eventTypes;
      if (secret) body.secret = secret;
      if (description) body.description = description;

      const result = await ctx.client.webhooks.createWebhookEndpoint({
        pathParams: { project_id: projectId },
        body,
      });

      output(result, args.json, () => {
        consola.success(`Webhook created: ${result.id}`);
        consola.log(`  URL: ${result.url}`);
      });
    });
  },
});
