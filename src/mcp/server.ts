import { describeByOperationId, operationsByPath, operationsByTag } from "pgbeam/operations";
import { rawRequest } from "../lib/client.js";
import { VERSION } from "../lib/constants.js";
import type { GlobalArgs } from "../lib/flags.js";

/**
 * Connect-time instructions returned in the MCP `initialize` result. Gives the
 * model a mental model of how to drive the management MCP; written for
 * code-generation clients. Mirrors the hosted Go management MCP.
 */
const INSTRUCTIONS =
  "PgBeam management MCP — administer your PgBeam account (projects, databases, policy profiles, agent credentials, audit, approvals, billing) over the REST API.\n\n" +
  "Only three tools are exposed regardless of API size:\n" +
  "- search_endpoints({query}) — find operations by intent; returns a compact list (id, method, path).\n" +
  "- describe_endpoint({operation_id}) — one operation's inputs and success response, rendered as compact TypeScript types (path/query params, request body, response). $refs are resolved inline.\n" +
  "- call_endpoint({operation_id, path_params, query_params, body}) — invoke it.\n\n" +
  "Flow: search → describe → call. Work top-down and chain ids: create/list a project to get its project_id, then pass it as a path_param to project-scoped operations (agents, databases, policies, audit). Resource ids returned by one call are the path_params of the next.\n\n" +
  "Auth: this CLI server dispatches with your configured PgBeam credentials (--token / profile). Errors are returned as tool results (isError=true) with the upstream status and message — read the message and adjust the arguments.";

/**
 * MCP tool annotations (readOnlyHint/destructiveHint/idempotentHint) let clients
 * reason about safety before invoking a tool. Mirrors the Go servers.
 */
interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  annotations?: ToolAnnotations;
}

class UnknownToolError extends Error {
  constructor(name: string) {
    super(`Unknown tool: ${name}`);
    this.name = "UnknownToolError";
  }
}

/** A single callable API operation, indexed by operationId. */
interface Endpoint {
  operationId: string;
  method: string;
  path: string;
  tag: string;
  pathParams: string[];
  acceptsBody: boolean;
}

const DEFAULT_SEARCH_LIMIT = 20;

function extractParams(path: string): string[] {
  const matches = path.match(/\{(\w+)\}/g);
  return matches ? matches.map((m) => m.slice(1, -1)) : [];
}

/**
 * Build the searchable endpoint index. Mirrors the hosted management MCP: a
 * fixed set of meta-tools over every operation, rather than one tool per
 * operation (which floods the agent's context with dozens of tools).
 */
function buildIndex(): Map<string, Endpoint> {
  // The generated maps are heterogeneous const objects; narrow each value to
  // the shape we read so we stay type-safe without `any`.
  type OperationMeta = { method: string; path: string; operationId: string };

  // operationId -> tag, from the tag-grouped map.
  const tagOf = new Map<string, string>();
  for (const [tag, ops] of Object.entries(operationsByTag)) {
    for (const operationId of Object.keys(ops)) {
      tagOf.set(operationId, tag);
    }
  }

  const index = new Map<string, Endpoint>();
  for (const meta of Object.values(operationsByPath) as OperationMeta[]) {
    index.set(meta.operationId, {
      operationId: meta.operationId,
      method: meta.method,
      path: meta.path,
      tag: tagOf.get(meta.operationId) ?? "",
      pathParams: extractParams(meta.path),
      acceptsBody: meta.method === "POST" || meta.method === "PATCH" || meta.method === "PUT",
    });
  }
  return index;
}

const ENDPOINTS = buildIndex();
const ORDERED_ENDPOINTS = [...ENDPOINTS.values()].sort((a, b) =>
  a.operationId.localeCompare(b.operationId),
);

const META_TOOLS: McpTool[] = [
  {
    name: "search_endpoints",
    description:
      "Search the PgBeam management API for operations by intent. Returns a compact list of " +
      "matching operations (id, method, path, tag). Call describe_endpoint next for an operation's " +
      "schema, then call_endpoint to invoke it.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            'Free-text intent, in words: "create an agent credential", "list audit entries". Every word must appear in the operation id, path or tag, so more words narrow the result. Omit to list all operations.',
        },
        limit: {
          type: "integer",
          description: `Maximum number of results (default ${DEFAULT_SEARCH_LIMIT}).`,
        },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "describe_endpoint",
    description:
      "Describe one API operation. Returns HTTP method, path, and the operation's inputs and " +
      "success response rendered as compact TypeScript types: path/query parameters, the " +
      "request-body type, and the response type, with $refs resolved inline. Use the " +
      "operation_id from search_endpoints.",
    inputSchema: {
      type: "object",
      properties: {
        operation_id: { type: "string", description: "The operationId from search_endpoints." },
      },
      required: ["operation_id"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "call_endpoint",
    description:
      "Invoke a PgBeam management API operation. Supply path_params for {placeholders}, query_params " +
      "for query-string values, and body for POST/PATCH/PUT bodies. May be destructive " +
      "(e.g. DELETE operations) depending on the operation dispatched.",
    inputSchema: {
      type: "object",
      properties: {
        operation_id: { type: "string", description: "The operationId to invoke." },
        path_params: {
          type: "object",
          description: 'Values for path placeholders, e.g. {"project_id": "prj_123"}.',
          additionalProperties: true,
        },
        query_params: {
          type: "object",
          description: "Query-string parameters.",
          additionalProperties: true,
        },
        body: {
          type: "object",
          description: "Request body for POST/PATCH/PUT operations.",
          additionalProperties: true,
        },
      },
      required: ["operation_id"],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  },
];

function asStringMap(value: unknown): Record<string, string> {
  if (value == null || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v != null && v !== "") out[k] = String(v);
  }
  return out;
}

/**
 * Everything about an endpoint a query could reasonably name, as lowercase words.
 *
 * `operationId` is camelCase, so it is split as well as kept whole:
 * `createAgentCredential` contributes `createagentcredential` and `create`,
 * `agent`, `credential`. Without the split, no query naming two of those three
 * things can match, because they are never adjacent as a substring.
 */
function haystack(ep: Endpoint): string {
  const camel = ep.operationId.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return `${ep.operationId} ${camel} ${ep.path} ${ep.tag}`.toLowerCase();
}

/**
 * Whether an endpoint matches, on every word of the query rather than the whole
 * string.
 *
 * The tool tells the caller to "find operations by intent", and intent is
 * phrased in words: "create an agent credential", "list audit entries". This
 * used to be one `includes(query)` against the operation id, the path and the
 * tag, so any query of more than one word matched nothing at all. Measured on
 * the shipped surface: "agent" returned 11 of 87 endpoints, "agent credential"
 * returned 0, and "create an agent credential" returned 0. An agent following
 * the documented search-describe-call flow therefore got `count: 0` on its first
 * call, with nothing in the result saying the query shape was the problem.
 *
 * Every word must appear somewhere, which keeps a two-word query narrower than
 * either word alone rather than flooding the caller with a union. Words of one
 * character and the handful of English filler words that carry no intent are
 * dropped, so "create an agent credential" asks for `create`, `agent` and
 * `credential` and finds `createAgentCredential`.
 */
const FILLER = new Set(["a", "an", "the", "for", "of", "to", "in", "on", "by", "and", "or", "my"]);

function queryTerms(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 1 && !FILLER.has(term));
}

function matchesQuery(ep: Endpoint, terms: readonly string[]): boolean {
  if (terms.length === 0) return true;
  const hay = haystack(ep);
  return terms.every((term) => hay.includes(term));
}

/**
 * How well an endpoint matches, so the best answers survive the result limit.
 *
 * With a default limit of 20 and 87 endpoints, which matches are dropped is as
 * much of the answer as which match. An exact operation id beats a partial one,
 * and a short id beats a long one carrying the same words, so `listAgents`
 * outranks `listAgentCredentialAuditEntries` for "list agents".
 */
function matchScore(ep: Endpoint, terms: readonly string[]): number {
  const id = ep.operationId.toLowerCase();
  const joined = terms.join("");
  let score = 0;
  if (id === joined) score += 1000;
  if (id.includes(joined)) score += 100;
  for (const term of terms) {
    if (id.includes(term)) score += 10;
    if (ep.tag.toLowerCase() === term) score += 5;
  }
  return score - id.length / 100;
}

function handleSearch(input: Record<string, unknown>): unknown {
  const query = String(input.query ?? "")
    .trim()
    .toLowerCase();
  const rawLimit = Number(input.limit);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : DEFAULT_SEARCH_LIMIT;

  const terms = queryTerms(query);
  let matched = ORDERED_ENDPOINTS.filter((ep) => matchesQuery(ep, terms));

  // Requiring every word is right when the caller's vocabulary matches the
  // API's, and a dead end when it does not. "list audit entries" names a real
  // operation, `listAuditLogs`, in words the API does not use: it says logs, the
  // caller said entries, and a strict match returns nothing with no hint that
  // one word was the problem. An empty result is the worst answer here, because
  // the caller cannot tell "no such operation" from "close, reword it".
  //
  // So a query that matches nothing strictly falls back to any word, ranked, and
  // the response says it did. The caller gets candidates to describe instead of
  // a zero, and knows not to read them as exact.
  const loose = terms.length > 0 && matched.length === 0;
  if (loose) {
    // Only the best tier, not everything touching one word. "list audit
    // entries" matches `listAuditLogs` on two words and a dozen unrelated
    // operations on "list" alone; returning all of them buries the answer in
    // the noise it is competing with. Keeping the highest hit count puts
    // `listAuditLogs` alone at the top, and a genuinely meaningless query still
    // degrades to a broad list rather than an empty one.
    const hits = new Map<string, number>();
    let best = 0;
    for (const ep of ORDERED_ENDPOINTS) {
      const hay = haystack(ep);
      const n = terms.filter((term) => hay.includes(term)).length;
      if (n > 0) hits.set(ep.operationId, n);
      if (n > best) best = n;
    }
    matched = ORDERED_ENDPOINTS.filter((ep) => hits.get(ep.operationId) === best);
  }
  // Ranked only when there is something to rank by. With no query the declared
  // order is the useful one, and sorting would shuffle the full listing.
  if (terms.length > 0) {
    matched.sort((a, b) => matchScore(b, terms) - matchScore(a, terms));
  }
  const endpoints = matched.slice(0, limit).map((ep) => ({
    operation_id: ep.operationId,
    method: ep.method,
    path: ep.path,
    tag: ep.tag,
  }));
  return {
    count: endpoints.length,
    // `matched` rather than `endpoints`, so a caller that hit the limit can see
    // there is more and ask for it, instead of reading a truncated list as the
    // whole answer.
    matched: matched.length,
    total: ORDERED_ENDPOINTS.length,
    ...(loose && {
      matched_loosely: true,
      note: `No operation matched every word of "${query}". These match at least one, best first. Check the operation id before calling one.`,
    }),
    endpoints,
  };
}

function handleDescribe(input: Record<string, unknown>): unknown {
  const id = String(input.operation_id ?? "").trim();
  const ep = ENDPOINTS.get(id);
  if (!ep) {
    throw new Error(`unknown operation_id "${id}" — use search_endpoints to find valid ids`);
  }
  // Compact TypeScript types for inputs + success response, matching the hosted
  // Go management MCP. Falls back to the operation-map basics if the pregenerated
  // describe entry is somehow absent.
  const describe = describeByOperationId[id];
  if (!describe) {
    return {
      operation_id: ep.operationId,
      method: ep.method,
      path: ep.path,
      tag: ep.tag,
      path_params: ep.pathParams,
      accepts_body: ep.acceptsBody,
    };
  }
  const result: Record<string, unknown> = {
    operation_id: describe.operationId,
    method: describe.method,
    path: describe.path,
    tag: ep.tag,
  };
  if (describe.summary) result.summary = describe.summary;
  if (describe.description) result.description = describe.description;
  if (describe.parameters.length > 0) {
    result.parameters = describe.parameters.map((p) => ({
      name: p.name,
      in: p.in,
      required: p.required,
      type: p.type,
      ...(p.description ? { description: p.description } : {}),
    }));
  }
  if (describe.requestBodyType) {
    result.request_body_type = describe.requestBodyType;
    result.request_body_required = describe.requestBodyRequired;
  }
  if (describe.responseType) {
    result.response_type = describe.responseType;
    result.response_status = describe.responseStatus;
  } else if (describe.responseStatus) {
    result.response_status = describe.responseStatus;
  }
  return result;
}

async function handleCall(input: Record<string, unknown>, args: GlobalArgs): Promise<unknown> {
  const id = String(input.operation_id ?? "").trim();
  const ep = ENDPOINTS.get(id);
  if (!ep) {
    throw new Error(`unknown operation_id "${id}" — use search_endpoints to find valid ids`);
  }

  const pathParams = asStringMap(input.path_params);
  for (const p of ep.pathParams) {
    if (!pathParams[p]) {
      throw new Error(`missing required path_params value: ${p}`);
    }
  }
  const queryParams = asStringMap(input.query_params);

  return rawRequest(args, ep.method, ep.path, {
    pathParams: ep.pathParams.length > 0 ? pathParams : undefined,
    queryParams: Object.keys(queryParams).length > 0 ? queryParams : undefined,
    body: input.body,
  });
}

async function handleToolCall(
  name: string,
  toolInput: Record<string, unknown>,
  args: GlobalArgs,
): Promise<unknown> {
  switch (name) {
    case "search_endpoints":
      return handleSearch(toolInput);
    case "describe_endpoint":
      return handleDescribe(toolInput);
    case "call_endpoint":
      return handleCall(toolInput, args);
    default:
      throw new UnknownToolError(name);
  }
}

interface JsonRpcRequest {
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export async function startMcpServer(args: GlobalArgs): Promise<void> {
  const tools = META_TOOLS;
  const readline = await import("node:readline");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  function send(msg: unknown): void {
    process.stdout.write(`${JSON.stringify(msg)}\n`);
  }

  rl.on("line", async (line) => {
    let request: JsonRpcRequest;
    try {
      request = JSON.parse(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }

    const id = request.id;

    switch (request.method) {
      case "initialize":
        send({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "pgbeam", version: VERSION },
            instructions: INSTRUCTIONS,
          },
        });
        break;

      case "notifications/initialized":
        break;

      case "ping":
        send({ jsonrpc: "2.0", id, result: {} });
        break;

      case "tools/list":
        send({
          jsonrpc: "2.0",
          id,
          result: { tools },
        });
        break;

      case "tools/call": {
        const toolName = String(request.params?.name ?? "");
        const toolInput: Record<string, unknown> = {};
        const rawArgs = request.params?.arguments;
        if (rawArgs && typeof rawArgs === "object") {
          Object.assign(toolInput, rawArgs);
        }
        try {
          const result = await handleToolCall(toolName, toolInput, args);
          send({
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            },
          });
        } catch (err) {
          if (err instanceof UnknownToolError) {
            // Protocol error: unknown tool (JSON-RPC error per MCP spec)
            send({
              jsonrpc: "2.0",
              id,
              error: { code: -32602, message: err.message },
            });
          } else {
            // Tool execution error: returned as result with isError flag
            send({
              jsonrpc: "2.0",
              id,
              result: {
                content: [
                  {
                    type: "text",
                    text: `Error: ${err instanceof Error ? err.message : String(err)}`,
                  },
                ],
                isError: true,
              },
            });
          }
        }
        break;
      }

      default:
        send({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not found: ${request.method}` },
        });
    }
  });

  rl.on("close", () => {
    process.exit(0);
  });
}
