import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("citty", () => ({
  defineCommand: (config: Record<string, unknown>) => config,
}));

vi.mock("../../lib/flags.js", () => ({
  globalArgs: {},
}));

vi.mock("pgbeam/operations", () => ({
  operationsByTag: {
    projects: {
      listProjects: { method: "GET", path: "/v1/projects" },
      getProject: { method: "GET", path: "/v1/projects/{project_id}" },
    },
  },
  operationsByPath: {
    "GET /v1/projects": { method: "GET", path: "/v1/projects", operationId: "listProjects" },
    "GET /v1/projects/{project_id}": {
      method: "GET",
      path: "/v1/projects/{project_id}",
      operationId: "getProject",
    },
  },
  describeByOperationId: {
    listProjects: {
      operationId: "listProjects",
      method: "GET",
      path: "/v1/projects",
      summary: "List projects",
      description: "Lists projects filtered by organization.",
      parameters: [
        {
          name: "org_id",
          in: "query",
          required: true,
          type: "string",
          description: "Organization ID to filter projects.",
        },
        { name: "page_size", in: "query", required: false, type: "number", description: "" },
      ],
      requestBodyType: "",
      requestBodyRequired: false,
      responseType: "{ projects: ({ id: string })[]; total: number }",
      responseStatus: "200",
    },
    getProject: {
      operationId: "getProject",
      method: "GET",
      path: "/v1/projects/{project_id}",
      summary: "Get a project",
      description: "",
      parameters: [
        { name: "project_id", in: "path", required: true, type: "string", description: "" },
      ],
      requestBodyType: "{ name: string }",
      requestBodyRequired: true,
      responseType: "{ id: string; name: string }",
      responseStatus: "200",
    },
  },
}));

vi.mock("../../lib/output.js", () => ({
  outputJson: vi.fn(),
}));

vi.mock("consola", () => ({
  consola: { log: vi.fn(), error: vi.fn() },
}));

const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
  throw new Error("process.exit");
});

import { consola } from "consola";
import { outputJson } from "../../lib/output.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function runHandler(args: Record<string, unknown>) {
  const mod = await import("./schema.js");
  const command = mod.default;
  await command.run?.({ args: { json: false, "no-color": false, debug: false, ...args } } as never);
}

function loggedLines(): string {
  return vi
    .mocked(consola.log)
    .mock.calls.map((c) => String(c[0]))
    .join("\n");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
});

describe("api schema", () => {
  it("finds operation by tag.operation format (human output)", async () => {
    await runHandler({ operation: "projects.listProjects" });

    const out = loggedLines();
    expect(out).toContain("projects");
    expect(out).toContain("listProjects");
  });

  it("prints parameters with name, location, required, and type", async () => {
    await runHandler({ operation: "projects.listProjects" });

    const out = loggedLines();
    expect(out).toContain("Parameters:");
    expect(out).toMatch(/org_id\s+query\s+required\s+string/);
    expect(out).toMatch(/page_size\s+query\s+optional\s+number/);
    expect(out).toContain("Organization ID to filter projects.");
  });

  it("prints the response shape and status", async () => {
    await runHandler({ operation: "projects.listProjects" });

    const out = loggedLines();
    expect(out).toContain("Response (200):");
    expect(out).toContain("{ projects: ({ id: string })[]; total: number }");
  });

  it("prints the request body shape with its required flag", async () => {
    await runHandler({ operation: "getProject" });

    const out = loggedLines();
    expect(out).toContain("Request body (required):");
    expect(out).toContain("{ name: string }");
  });

  it("finds operation by tag.operation format (JSON output)", async () => {
    await runHandler({ operation: "projects.listProjects", json: true });

    expect(outputJson).toHaveBeenCalledWith(
      expect.objectContaining({
        tag: "projects",
        operationId: "listProjects",
        method: "GET",
        path: "/v1/projects",
        parameters: expect.arrayContaining([
          expect.objectContaining({ name: "org_id", in: "query", required: true, type: "string" }),
        ]),
        responseType: "{ projects: ({ id: string })[]; total: number }",
        responseStatus: "200",
      }),
    );
  });

  it("finds operation by route key", async () => {
    await runHandler({ operation: "GET /v1/projects" });

    const out = loggedLines();
    expect(out).toContain("listProjects");
    expect(out).toContain("/v1/projects");
  });

  it("finds operation by operationId", async () => {
    await runHandler({ operation: "getProject" });

    expect(loggedLines()).toContain("getProject");
  });

  it("exits with error for unknown tag.operation", async () => {
    await expect(runHandler({ operation: "projects.nonExistent" })).rejects.toThrow("process.exit");

    expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("exits with error for unknown route/operationId", async () => {
    await expect(runHandler({ operation: "DELETE /v1/nothing" })).rejects.toThrow("process.exit");

    expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
