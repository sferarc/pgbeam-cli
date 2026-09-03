import { defineCommand } from "citty";
import { resolveContext } from "../lib/client.js";
import { runCommand } from "../lib/errors.js";
import { globalArgs } from "../lib/flags.js";
import { output, outputTable } from "../lib/output.js";

export default defineCommand({
  meta: {
    name: "regions",
    description: "List available regions",
    icon: "Globe",
    docs: {
      longDescription:
        "List all available PgBeam data plane regions. Shows each region's ID, display name, and cloud provider. This is a public endpoint that does not require authentication.",
      examples: [
        { comment: "List all regions", command: "pgbeam platform regions" },
        { comment: "List regions as JSON", command: "pgbeam platform regions --json" },
      ],
      response:
        "Displays a table with columns: ID, Name, and Provider. With `--json`, returns the full regions array.",
    },
  },
  args: {
    ...globalArgs,
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);

      const result = await ctx.client.platform.listRegions();

      output(result, args.json, () => {
        outputTable(
          result.regions.map((r) => ({
            id: r.id,
            name: r.name,
            provider: r.provider,
          })),
          [
            { key: "id", label: "ID" },
            { key: "name", label: "Name" },
            { key: "provider", label: "Provider" },
          ],
        );
      });
    });
  },
});
