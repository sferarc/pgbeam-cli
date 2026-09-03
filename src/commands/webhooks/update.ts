import { defineCommand } from "citty";
import { consola } from "consola";
import type { WebhookEndpointInput, WebhookEndpointInputFormatEnumKey } from "pgbeam";
import { optionalArg, parseEnum, requireArg } from "../../lib/args.js";

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
    name: "update",
    description: "Update a webhook endpoint",
    docs: {
      longDescription:
        "Update the configuration of an existing webhook endpoint. Only the fields you provide are changed; current settings are preserved for any flag not specified. Use `--event` to replace the subscribed event types (comma-separated) and `--enabled` to toggle delivery.",
      examples: [
        {
          comment: "Change a webhook's URL",
          command: "pgbeam webhooks update wh_xxx --url https://new.example.com/hook",
        },
        {
          comment: "Subscribe a webhook to specific events",
          command: "pgbeam webhooks update wh_xxx --event query.blocked,policy.updated",
        },
        { comment: "Disable a webhook", command: "pgbeam webhooks update wh_xxx --enabled=false" },
      ],
      response:
        "Prints a success message confirming the webhook was updated. With `--json`, returns the full updated webhook object from the API.",
    },
  },
  args: {
    ...globalArgs,
    id: {
      type: "positional",
      description: "ID of the webhook endpoint to update",
      required: true,
    },
    url: {
      type: "string",
      description: "New destination URL for webhook deliveries.",
    },
    format: {
      type: "string",
      description: "New delivery format: json, splunk_hec, datadog, or elastic.",
    },
    event: {
      type: "string",
      description: "Replace subscribed event type(s). Comma-separated.",
    },
    secret: {
      type: "string",
      description: "New shared secret used to sign webhook payloads.",
    },
    description: {
      type: "string",
      description: "New human-readable description for the webhook endpoint.",
    },
    enabled: {
      type: "boolean",
      description: "Enable (true) or disable (false) the webhook endpoint.",
    },
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);
      const projectId = requireProject(ctx);
      const webhookId = requireArg(args.id, "webhook ID");

      // Fetch current endpoint to merge with user-provided values.
      const current = await ctx.client.webhooks.getWebhookEndpoint({
        pathParams: { project_id: projectId, webhook_id: webhookId },
      });

      const url = optionalArg(args.url);
      const format = optionalArg(args.format);
      const secret = optionalArg(args.secret);
      const description = optionalArg(args.description);
      const eventTypes = optionalArg(args.event)
        ?.split(",")
        .map((e) => e.trim())
        .filter((e) => e.length > 0);

      const body: WebhookEndpointInput = {
        url: url ?? current.url,
        format: format ? parseEnum(format, webhookFormats, "format") : current.format,
        event_types: eventTypes ?? current.event_types,
        enabled: args.enabled !== undefined ? args.enabled : current.enabled,
      };
      if (secret) body.secret = secret;
      if (description !== undefined) {
        body.description = description;
      } else if (current.description !== undefined) {
        body.description = current.description;
      }

      const result = await ctx.client.webhooks.updateWebhookEndpoint({
        pathParams: { project_id: projectId, webhook_id: webhookId },
        body,
      });

      output(result, args.json, () => {
        consola.success(`Webhook ${webhookId} updated.`);
      });
    });
  },
});
