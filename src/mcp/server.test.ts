import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock external packages and internal modules before imports.
// pgbeam/operations provides the operation registry that drives tool generation.
vi.mock("pgbeam/operations", () => ({
  operationsByPath: {
    "GET /v1/health": { method: "GET", path: "/v1/health", operationId: "getHealth" },
    "GET /v1/plans": { method: "GET", path: "/v1/plans", operationId: "listPlans" },
    "GET /v1/projects": { method: "GET", path: "/v1/projects", operationId: "listProjects" },
    "POST /v1/projects": { method: "POST", path: "/v1/projects", operationId: "createProject" },
    "GET /v1/projects/{project_id}": {
      method: "GET",
      path: "/v1/projects/{project_id}",
      operationId: "getProject",
    },
    "PATCH /v1/projects/{project_id}": {
      method: "PATCH",
      path: "/v1/projects/{project_id}",
      operationId: "updateProject",
    },
    "DELETE /v1/projects/{project_id}": {
      method: "DELETE",
      path: "/v1/projects/{project_id}",
      operationId: "deleteProject",
    },
    "PUT /v1/organizations/{org_id}/spend-limit": {
      method: "PUT",
      path: "/v1/organizations/{org_id}/spend-limit",
      operationId: "updateSpendLimit",
    },
    "GET /v1/projects/{project_id}/databases/{database_id}": {
      method: "GET",
      path: "/v1/projects/{project_id}/databases/{database_id}",
      operationId: "getDatabase",
    },
  },
  operationsByTag: {
    health: { getHealth: { method: "GET", path: "/v1/health" } },
    billing: {
      listPlans: { method: "GET", path: "/v1/plans" },
      updateSpendLimit: { method: "PUT", path: "/v1/organizations/{org_id}/spend-limit" },
    },
    projects: {
      listProjects: { method: "GET", path: "/v1/projects" },
      createProject: { method: "POST", path: "/v1/projects" },
      getProject: { method: "GET", path: "/v1/projects/{project_id}" },
      updateProject: { method: "PATCH", path: "/v1/projects/{project_id}" },
      deleteProject: { method: "DELETE", path: "/v1/projects/{project_id}" },
    },
    databases: {
      getDatabase: { method: "GET", path: "/v1/projects/{project_id}/databases/{database_id}" },
    },
  },
  describeByOperationId: {
    getProject: {
      operationId: "getProject",
      method: "GET",
      path: "/v1/projects/{project_id}",
      summary: "Get a project",
      description: "",
      parameters: [
        { name: "project_id", in: "path", required: true, type: "string", description: "" },
      ],
      requestBodyType: "",
      requestBodyRequired: false,
      responseType: "{ id: string; name: string }",
      responseStatus: "200",
    },
    createProject: {
      operationId: "createProject",
      method: "POST",
      path: "/v1/projects",
      summary: "Create a project",
      description: "",
      parameters: [],
      requestBodyType: '{ name: string; cloud?: "aws" | "gcp" | "azure" }',
      requestBodyRequired: true,
      responseType: "{ id: string }",
      responseStatus: "201",
    },
  },
}));

vi.mock("../lib/client.js", () => ({
  rawRequest: vi.fn(),
}));

vi.mock("../lib/constants.js", () => ({
  VERSION: "0.0.0-test",
}));

import { rawRequest } from "../lib/client.js";
import { startMcpServer } from "./server.js";

const mockRawRequest = vi.mocked(rawRequest);

/**
 * Helper to capture stdout writes and simulate stdin lines.
 * Sets up a fake readline-compatible stdin/stdout pair.
 */
function createStdioHarness() {
  const messages: unknown[] = [];
  const originalWrite = process.stdout.write;
  const stdinEmitter = new EventEmitter();

  // Capture JSON lines written to stdout
  process.stdout.write = vi.fn((chunk: string | Uint8Array) => {
    const line = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    if (line.trim()) {
      messages.push(JSON.parse(line.trim()));
    }
    return true;
  }) as typeof process.stdout.write;

  // Override process.stdin to be our emitter (readline reads from it)
  const originalStdin = process.stdin;
  const fakeStdin = Object.assign(stdinEmitter, {
    setEncoding: vi.fn(),
    resume: vi.fn(),
    pause: vi.fn(),
    read: vi.fn(),
    readable: true,
    isTTY: false,
    // Minimal readable-stream compat for readline
    [Symbol.asyncIterator]: vi.fn(),
  });
  Object.defineProperty(process, "stdin", {
    value: fakeStdin,
    writable: true,
    configurable: true,
  });

  function sendLine(obj: unknown): void {
    stdinEmitter.emit("data", `${JSON.stringify(obj)}\n`);
  }

  function restore(): void {
    process.stdout.write = originalWrite;
    Object.defineProperty(process, "stdin", {
      value: originalStdin,
      writable: true,
      configurable: true,
    });
  }

  return { messages, sendLine, restore, stdinEmitter };
}

describe("MCP server", () => {
  let harness: ReturnType<typeof createStdioHarness>;
  const defaultArgs = {
    token: "test-token",
    json: false,
    "no-color": false,
    debug: false,
  };

  // Prevent process.exit from actually exiting
  const originalExit = process.exit;

  beforeEach(() => {
    process.exit = vi.fn() as never;
    harness = createStdioHarness();
    mockRawRequest.mockReset();
  });

  afterEach(() => {
    harness.restore();
    process.exit = originalExit;
  });

  async function startAndWait() {
    // Start the server -- it sets up readline and returns
    const serverPromise = startMcpServer(defaultArgs);
    // Give the event loop a tick for readline to be set up
    await new Promise((r) => setTimeout(r, 10));
    return serverPromise;
  }

  async function sendAndCollect(request: unknown): Promise<unknown> {
    const before = harness.messages.length;
    harness.sendLine(request);
    // Allow async processing
    await new Promise((r) => setTimeout(r, 10));
    return harness.messages[before];
  }

  describe("initialize", () => {
    it("responds with protocol version and server info", async () => {
      await startAndWait();

      const response = await sendAndCollect({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      });

      expect(response).toMatchObject({
        jsonrpc: "2.0",
        id: 1,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "pgbeam", version: "0.0.0-test" },
        },
      });
      // Connect-time instructions give the model its mental model.
      const result = (response as { result: { instructions?: string } }).result;
      expect(result.instructions).toContain("search → describe → call");
    });
  });

  describe("ping", () => {
    it("responds with empty result", async () => {
      await startAndWait();

      const response = await sendAndCollect({
        jsonrpc: "2.0",
        id: 42,
        method: "ping",
      });

      expect(response).toEqual({
        jsonrpc: "2.0",
        id: 42,
        result: {},
      });
    });
  });

  describe("notifications/initialized", () => {
    it("does not produce a response", async () => {
      await startAndWait();
      const before = harness.messages.length;

      harness.sendLine({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });
      await new Promise((r) => setTimeout(r, 10));

      expect(harness.messages.length).toBe(before);
    });
  });

  describe("tools/list", () => {
    it("exposes exactly the three meta-tools regardless of operation count", async () => {
      await startAndWait();

      const response = (await sendAndCollect({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      })) as {
        result: {
          tools: Array<{
            name: string;
            description: string;
            inputSchema: unknown;
            annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
          }>;
        };
      };

      const tools = response.result.tools;
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.map((t) => t.name).sort()).toEqual([
        "call_endpoint",
        "describe_endpoint",
        "search_endpoints",
      ]);

      for (const tool of tools) {
        expect(tool).toHaveProperty("name");
        expect(tool).toHaveProperty("description");
        expect(tool.inputSchema).toHaveProperty("type", "object");
      }

      // Read-only meta-tools flagged so clients can skip confirmations; the
      // dispatching call_endpoint is flagged potentially destructive.
      const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
      expect(byName.search_endpoints.annotations?.readOnlyHint).toBe(true);
      expect(byName.describe_endpoint.annotations?.readOnlyHint).toBe(true);
      expect(byName.call_endpoint.annotations?.readOnlyHint).toBe(false);
      expect(byName.call_endpoint.annotations?.destructiveHint).toBe(true);
    });
  });

  describe("search_endpoints", () => {
    async function search(args: Record<string, unknown>, id: number) {
      const response = (await sendAndCollect({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name: "search_endpoints", arguments: args },
      })) as { result: { content: Array<{ type: string; text: string }> } };
      return JSON.parse(response.result.content[0].text) as {
        count: number;
        matched: number;
        total: number;
        matched_loosely?: boolean;
        note?: string;
        endpoints: Array<{ operation_id: string; method: string; path: string; tag: string }>;
      };
    }

    it("matches operations by intent and reports the total", async () => {
      await startAndWait();
      const result = await search({ query: "project" }, 20);
      expect(result.total).toBe(9);
      const ids = result.endpoints.map((e) => e.operation_id);
      expect(ids).toContain("getProject");
      expect(ids).toContain("createProject");
      expect(ids).not.toContain("getHealth");
    });

    it("matches every word of an intent, not the whole string", async () => {
      // The tool tells the caller to search by intent, and intent is phrased in
      // words. This used to be one `includes(query)` against the id, path and
      // tag, so any query longer than one word matched nothing: measured on the
      // shipped surface, "agent" found 11 of 87 endpoints and "agent
      // credential" found 0. The documented search-describe-call flow therefore
      // dead-ended on its first call.
      await startAndWait();
      const result = await search({ query: "create a project" }, 30);
      expect(result.matched_loosely).toBeUndefined();
      expect(result.endpoints.map((e) => e.operation_id)).toContain("createProject");
    });

    it("puts the exact operation first, because the limit decides what is seen", async () => {
      await startAndWait();
      const result = await search({ query: "get project" }, 31);
      expect(result.endpoints[0]?.operation_id).toBe("getProject");
    });

    it("falls back to the closest operations rather than returning nothing", async () => {
      // The caller's vocabulary need not be the API's. An empty result cannot be
      // told apart from "no such operation", so a query matching nothing
      // strictly degrades to the best partial matches and says so.
      await startAndWait();
      const result = await search({ query: "project nonsensewordhere" }, 32);
      expect(result.matched_loosely).toBe(true);
      expect(result.note).toContain("every word");
      expect(result.endpoints.length).toBeGreaterThan(0);
    });

    it("lists all operations when query is omitted", async () => {
      await startAndWait();
      const result = await search({}, 21);
      expect(result.count).toBe(9);
      expect(result.total).toBe(9);
    });

    it("caps results at the limit while still reporting the total", async () => {
      await startAndWait();
      const result = await search({ limit: 2 }, 22);
      expect(result.count).toBe(2);
      expect(result.total).toBe(9);
    });

    it("matches by tag", async () => {
      await startAndWait();
      const result = await search({ query: "billing" }, 23);
      const ids = result.endpoints.map((e) => e.operation_id).sort();
      expect(ids).toEqual(["listPlans", "updateSpendLimit"]);
    });
  });

  describe("describe_endpoint", () => {
    async function describe(operationId: string, id: number) {
      return (await sendAndCollect({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name: "describe_endpoint", arguments: { operation_id: operationId } },
      })) as { result: { content: Array<{ type: string; text: string }>; isError?: boolean } };
    }

    it("returns method, path, and parameters as compact TypeScript types", async () => {
      await startAndWait();
      const response = await describe("getProject", 30);
      const detail = JSON.parse(response.result.content[0].text);
      expect(detail).toMatchObject({
        operation_id: "getProject",
        method: "GET",
        path: "/v1/projects/{project_id}",
        response_type: "{ id: string; name: string }",
        response_status: "200",
      });
      expect(detail.parameters).toEqual([
        { name: "project_id", in: "path", required: true, type: "string" },
      ]);
    });

    it("renders the request body as a compact TypeScript type", async () => {
      await startAndWait();
      const response = await describe("createProject", 31);
      const detail = JSON.parse(response.result.content[0].text);
      expect(detail.request_body_type).toBe('{ name: string; cloud?: "aws" | "gcp" | "azure" }');
      expect(detail.request_body_required).toBe(true);
      expect(detail.response_type).toBe("{ id: string }");
    });

    it("returns an error for an unknown operation", async () => {
      await startAndWait();
      const response = await describe("nope", 32);
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0].text).toContain("unknown operation_id");
    });
  });

  describe("call_endpoint", () => {
    async function call(args: Record<string, unknown>, id: number) {
      return (await sendAndCollect({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name: "call_endpoint", arguments: args },
      })) as { result: { content: Array<{ type: string; text: string }>; isError?: boolean } };
    }

    it("dispatches with path parameters", async () => {
      mockRawRequest.mockResolvedValue({ id: "proj_123", name: "My Project" });
      await startAndWait();

      const response = await call(
        { operation_id: "getProject", path_params: { project_id: "proj_123" } },
        40,
      );

      expect(mockRawRequest).toHaveBeenCalledWith(defaultArgs, "GET", "/v1/projects/{project_id}", {
        pathParams: { project_id: "proj_123" },
        queryParams: undefined,
        body: undefined,
      });
      expect(JSON.parse(response.result.content[0].text)).toEqual({
        id: "proj_123",
        name: "My Project",
      });
    });

    it("passes the body for POST requests", async () => {
      mockRawRequest.mockResolvedValue({ id: "proj_new" });
      await startAndWait();

      const body = { name: "New Project", org_id: "org_1" };
      await call({ operation_id: "createProject", body }, 41);

      expect(mockRawRequest).toHaveBeenCalledWith(defaultArgs, "POST", "/v1/projects", {
        pathParams: undefined,
        queryParams: undefined,
        body,
      });
    });

    it("passes query_params", async () => {
      mockRawRequest.mockResolvedValue({ items: [] });
      await startAndWait();

      await call(
        { operation_id: "listProjects", query_params: { org_id: "org_123", limit: "10" } },
        42,
      );

      expect(mockRawRequest).toHaveBeenCalledWith(defaultArgs, "GET", "/v1/projects", {
        pathParams: undefined,
        queryParams: { org_id: "org_123", limit: "10" },
        body: undefined,
      });
    });

    it("handles multiple path parameters", async () => {
      mockRawRequest.mockResolvedValue({ database_id: "db_1" });
      await startAndWait();

      await call(
        { operation_id: "getDatabase", path_params: { project_id: "proj_1", database_id: "db_1" } },
        43,
      );

      expect(mockRawRequest).toHaveBeenCalledWith(
        defaultArgs,
        "GET",
        "/v1/projects/{project_id}/databases/{database_id}",
        {
          pathParams: { project_id: "proj_1", database_id: "db_1" },
          queryParams: undefined,
          body: undefined,
        },
      );
    });

    it("returns an error result when a path param is missing", async () => {
      await startAndWait();
      const response = await call({ operation_id: "getProject" }, 44);
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0].text).toContain("project_id");
    });

    it("returns an error result for an unknown operation_id", async () => {
      await startAndWait();
      const response = await call({ operation_id: "nope" }, 45);
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0].text).toContain("unknown operation_id");
    });

    it("surfaces rawRequest failures as an error result", async () => {
      mockRawRequest.mockRejectedValue(new Error("401 Unauthorized"));
      await startAndWait();
      const response = await call(
        { operation_id: "getProject", path_params: { project_id: "proj_123" } },
        46,
      );
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0].text).toContain("401 Unauthorized");
    });

    it("returns a JSON-RPC error for an unknown meta-tool name", async () => {
      await startAndWait();
      const response = (await sendAndCollect({
        jsonrpc: "2.0",
        id: 47,
        method: "tools/call",
        params: { name: "nonExistentTool", arguments: {} },
      })) as { error: { code: number; message: string } };

      expect(response.error.code).toBe(-32602);
      expect(response.error.message).toContain("Unknown tool: nonExistentTool");
    });
  });

  describe("error handling", () => {
    it("returns parse error for invalid JSON", async () => {
      await startAndWait();

      const before = harness.messages.length;
      // Send raw invalid JSON via the stdin emitter
      harness.stdinEmitter.emit("data", "not valid json\n");
      await new Promise((r) => setTimeout(r, 10));

      const response = harness.messages[before] as { error: { code: number; message: string } };
      expect(response.error.code).toBe(-32700);
      expect(response.error.message).toBe("Parse error");
    });

    it("returns method not found for unknown methods", async () => {
      await startAndWait();

      const response = (await sendAndCollect({
        jsonrpc: "2.0",
        id: 20,
        method: "unknown/method",
      })) as { error: { code: number; message: string } };

      expect(response.error.code).toBe(-32601);
      expect(response.error.message).toContain("Method not found: unknown/method");
    });
  });

  describe("close", () => {
    it("calls process.exit(0) when stdin closes", async () => {
      await startAndWait();

      // Emit "end" on stdin to trigger readline's "close" event
      harness.stdinEmitter.emit("end");
      await new Promise((r) => setTimeout(r, 50));

      expect(process.exit).toHaveBeenCalledWith(0);
    });
  });
});
