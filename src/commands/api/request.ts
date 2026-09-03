import { defineCommand } from "citty";
import { consola } from "consola";
import { operationsByPath } from "pgbeam/operations";
import { requireArg, typedEntries } from "../../lib/args.js";
import { rawRequest } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";
import { outputJson } from "../../lib/output.js";

function matchRoute(
  method: string,
  concretePath: string,
): { path: string; pathParams: Record<string, string> } | null {
  for (const [routeKey, meta] of typedEntries(operationsByPath)) {
    const routeMethod = routeKey.split(" ", 1)[0];
    if (routeMethod !== method) continue;

    const templateParts = meta.path.split("/");
    const concreteParts = concretePath.split("/");

    if (templateParts.length !== concreteParts.length) continue;

    const params: Record<string, string> = {};
    let match = true;

    for (let i = 0; i < templateParts.length; i++) {
      const tpl = templateParts[i];
      const val = concreteParts[i];
      if (tpl.startsWith("{") && tpl.endsWith("}")) {
        params[tpl.slice(1, -1)] = val;
      } else if (tpl !== val) {
        match = false;
        break;
      }
    }

    if (match) return { path: meta.path, pathParams: params };
  }
  return null;
}

export default defineCommand({
  meta: {
    name: "request",
    description: "Make a raw API request",
    docs: {
      longDescription:
        "Make a direct HTTP request to the PgBeam API. Supports path parameter interpolation — if the path matches a known API route template, path parameters are extracted automatically. Use `--data` (or `-d`) to send a JSON request body. Every request is authenticated via the active profile (or `--token` / `PGBEAM_API_KEY`), including reads like `/v1/regions`.",
      examples: [
        {
          comment: "List all regions",
          command: "pgbeam api request GET /v1/regions",
        },
        {
          comment: "Get a specific project",
          command: "pgbeam api request GET /v1/projects/prj_xxx",
        },
        {
          comment: "Create a project with a JSON body",
          command:
            'pgbeam api request POST /v1/projects -d \'{"name": "my-app", "org_id": "org_xxx"}\'',
        },
        {
          comment: "Delete a database",
          command: "pgbeam api request DELETE /v1/projects/prj_xxx/databases/db_xxx",
        },
      ],
      response:
        "Outputs the API response as formatted JSON. Exits with a non-zero code on HTTP errors.",
    },
  },
  args: {
    ...globalArgs,
    method: {
      type: "positional",
      description: "HTTP method: GET, POST, PATCH, PUT, or DELETE",
      required: true,
    },
    path: {
      type: "positional",
      description: "API path (e.g. /v1/projects, /v1/regions)",
      required: true,
    },
    data: {
      type: "string",
      alias: "d",
      description: "JSON request body to send with the request",
    },
  },
  async run({ args }) {
    await runCommand(async () => {
      const method = requireArg(args.method, "method").toUpperCase();
      const path = requireArg(args.path, "path");

      let body: unknown;
      if (args.data) {
        try {
          body = JSON.parse(args.data);
        } catch {
          consola.error("Invalid JSON body.");
          process.exit(1);
        }
      }

      const matched = matchRoute(method, path);

      if (matched) {
        const result = await rawRequest(args, method, matched.path, {
          pathParams: matched.pathParams,
          body,
        });
        outputJson(result);
      } else {
        const result = await rawRequest(args, method, path, { body });
        outputJson(result);
      }
    });
  },
});
