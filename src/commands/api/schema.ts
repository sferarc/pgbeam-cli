import { defineCommand } from "citty";
import { consola } from "consola";
import {
  type DescribeEndpoint,
  describeByOperationId,
  operationsByPath,
  operationsByTag,
} from "pgbeam/operations";
import { requireArg, typedEntries } from "../../lib/args.js";
import { globalArgs } from "../../lib/flags.js";
import { outputJson } from "../../lib/output.js";

/**
 * Resolve an operation reference (`tag.method`, operationId, or route string)
 * to its operationId plus tag. Returns null when nothing matches.
 */
function resolveOperation(ref: string): { tag: string; operationId: string } | null {
  // tag.operation format
  if (ref.includes(".")) {
    const [tag, method] = ref.split(".", 2);
    const tagOps = (operationsByTag as Record<string, Record<string, unknown>>)[tag];
    if (tagOps && method in tagOps) {
      return { tag, operationId: method };
    }
    return null;
  }

  // Route string ("GET /v1/projects") or bare operationId
  for (const [route, meta] of typedEntries(operationsByPath)) {
    if (route === ref || meta.operationId === ref) {
      return { tag: tagForOperation(meta.operationId), operationId: meta.operationId };
    }
  }
  return null;
}

function tagForOperation(operationId: string): string {
  for (const [tag, ops] of Object.entries(operationsByTag)) {
    if (operationId in (ops as Record<string, unknown>)) return tag;
  }
  return "";
}

function printHuman(tag: string, describe: DescribeEndpoint): void {
  consola.log(`Operation: ${describe.operationId}`);
  if (tag) consola.log(`Tag:       ${tag}`);
  consola.log(`Method:    ${describe.method}`);
  consola.log(`Path:      ${describe.path}`);
  if (describe.summary) consola.log(`Summary:   ${describe.summary}`);
  if (describe.description && describe.description !== describe.summary) {
    consola.log(`Details:   ${describe.description}`);
  }

  if (describe.parameters.length > 0) {
    consola.log("");
    consola.log("Parameters:");
    const nameWidth = Math.max(...describe.parameters.map((p) => p.name.length));
    for (const p of describe.parameters) {
      const requirement = p.required ? "required" : "optional";
      const line = `  ${p.name.padEnd(nameWidth)}  ${p.in}  ${requirement}  ${p.type}`;
      consola.log(p.description ? `${line}  ${p.description}` : line);
    }
  }

  if (describe.requestBodyType) {
    consola.log("");
    consola.log(`Request body (${describe.requestBodyRequired ? "required" : "optional"}):`);
    consola.log(`  ${describe.requestBodyType}`);
  }

  if (describe.responseType) {
    consola.log("");
    consola.log(`Response (${describe.responseStatus}):`);
    consola.log(`  ${describe.responseType}`);
  } else if (describe.responseStatus) {
    consola.log("");
    consola.log(`Response: ${describe.responseStatus} (no content)`);
  }
}

export default defineCommand({
  meta: {
    name: "schema",
    description: "Show operation schema",
    docs: {
      longDescription:
        "Show the contract schema for an API operation: HTTP method and path, every parameter (name, location, required, type), the request body shape, and the success response shape. You can look up operations by their `tag.method` name (e.g. `projects.listProjects`), by operationId, or by route string.",
      examples: [
        {
          comment: "Look up by tag.method name",
          command: "pgbeam api schema projects.listProjects",
        },
        { comment: "Look up by operationId", command: "pgbeam api schema listProjects" },
        {
          comment: "Get schema as JSON",
          command: "pgbeam api schema projects.listProjects --json",
        },
      ],
      response:
        "Displays the operation, tag, HTTP method, path, parameters (name, location, required, type), request body shape, and response shape. With `--json`, returns the full operation schema object.",
    },
  },
  args: {
    ...globalArgs,
    operation: {
      type: "positional",
      description:
        "Operation name in tag.method format (e.g. projects.listProjects), operationId, or route string",
      required: true,
    },
  },
  async run({ args }) {
    const op = requireArg(args.operation, "operation");

    const resolved = resolveOperation(op);
    if (!resolved) {
      consola.error(`Operation "${op}" not found. Run \`pgbeam api ls\` to see all endpoints.`);
      process.exit(1);
    }

    const describe = describeByOperationId[resolved.operationId];
    if (!describe) {
      // Every operation in the maps has a describe entry (both are generated
      // from the same contract); guard anyway so a drift fails loudly.
      consola.error(
        `Operation "${resolved.operationId}" has no schema entry; regenerate the SDK maps.`,
      );
      process.exit(1);
    }

    if (args.json) {
      outputJson({ tag: resolved.tag, ...describe });
    } else {
      printHuman(resolved.tag, describe);
    }
  },
});
