import { defineCommand } from "citty";
import { consola } from "consola";
import { operationsByTag } from "pgbeam/operations";
import { globalArgs } from "../../lib/flags.js";
import { output } from "../../lib/output.js";

export default defineCommand({
  meta: {
    name: "ls",
    description: "List all API endpoints",
    docs: {
      longDescription:
        "List all available PgBeam API endpoints, grouped by tag. Shows the HTTP method, path, and operation name for each endpoint. Useful for discovering API operations before using `pgbeam api request` or `pgbeam api schema`.",
      examples: [
        { comment: "List all API endpoints", command: "pgbeam api ls" },
        { comment: "List endpoints as JSON", command: "pgbeam api ls --json" },
      ],
      response:
        "Displays endpoints grouped by tag, with each entry showing the HTTP method, path, and operation name. With `--json`, returns an array of endpoint objects with method, path, tag, and operation fields.",
    },
  },
  args: {
    ...globalArgs,
  },
  async run({ args }) {
    const endpoints: { method: string; path: string; tag: string; operation: string }[] = [];

    for (const [tag, ops] of Object.entries(operationsByTag)) {
      for (const [opName, op] of Object.entries(ops)) {
        endpoints.push({
          method: op.method,
          path: op.path,
          tag,
          operation: opName,
        });
      }
    }

    if (args.json) {
      output(endpoints, true);
      return;
    }

    let currentTag = "";
    for (const ep of endpoints) {
      if (ep.tag !== currentTag) {
        if (currentTag) consola.log("");
        consola.log(`  ${ep.tag}`);
        currentTag = ep.tag;
      }
      const method = ep.method.padEnd(6);
      consola.log(`    ${method} ${ep.path}  (${ep.operation})`);
    }
  },
});
