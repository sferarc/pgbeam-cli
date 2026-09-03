import { defineCommand } from "citty";
import { requireProject, resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";
import { output, outputTable } from "../../lib/output.js";

export default defineCommand({
  meta: {
    name: "list",
    description: "List webhook endpoints",
    docs: {
      longDescription:
        "List all webhook endpoints configured for the linked project. Shows each endpoint's ID, URL, delivery format, enabled state, and subscribed event types.",
      examples: [
        { comment: "List all webhook endpoints", command: "pgbeam webhooks list" },
        { comment: "List webhook endpoints as JSON", command: "pgbeam webhooks list --json" },
      ],
      response:
        "Displays a table with columns: ID, URL, Format, Enabled (yes/no), and Events ('all' when no specific event types are set). With `--json`, returns the full webhook list from the API.",
    },
  },
  args: {
    ...globalArgs,
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);
      const projectId = requireProject(ctx);

      const result = await ctx.client.webhooks.listWebhookEndpoints({
        pathParams: { project_id: projectId },
      });

      output(result, args.json, () => {
        outputTable(
          result.webhooks.map((w) => ({
            id: w.id,
            url: w.url,
            format: w.format,
            enabled: w.enabled ? "yes" : "no",
            events: w.event_types && w.event_types.length > 0 ? w.event_types.join(",") : "all",
          })),
          [
            { key: "id", label: "ID" },
            { key: "url", label: "URL" },
            { key: "format", label: "Format" },
            { key: "enabled", label: "Enabled" },
            { key: "events", label: "Events" },
          ],
        );
      });
    });
  },
});
