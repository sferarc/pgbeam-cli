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
  operationsByPath: {
    "GET /v1/projects": { method: "GET", path: "/v1/projects", operationId: "listProjects" },
    "GET /v1/projects/{project_id}": {
      method: "GET",
      path: "/v1/projects/{project_id}",
      operationId: "getProject",
    },
  },
}));

vi.mock("../../lib/client.js", () => ({
  rawRequest: vi.fn(),
}));

vi.mock("../../lib/errors.js", () => ({
  runCommand: vi.fn(async (fn: () => Promise<void>) => fn()),
}));

vi.mock("../../lib/output.js", () => ({
  outputJson: vi.fn(),
}));

vi.mock("consola", () => ({
  consola: { error: vi.fn(), log: vi.fn() },
}));

const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
  throw new Error("process.exit");
});

import { consola } from "consola";
import { rawRequest } from "../../lib/client.js";
import { outputJson } from "../../lib/output.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function runHandler(args: Record<string, unknown>) {
  const mod = await import("./request.js");
  const command = mod.default;
  await command.run?.({ args: { json: false, "no-color": false, debug: false, ...args } } as never);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
});

describe("api request", () => {
  it("matches a known route and calls rawRequest with pathParams", async () => {
    vi.mocked(rawRequest).mockResolvedValue({ id: "proj-1" });

    await runHandler({ method: "GET", path: "/v1/projects/proj-1" });

    expect(rawRequest).toHaveBeenCalledWith(expect.anything(), "GET", "/v1/projects/{project_id}", {
      pathParams: { project_id: "proj-1" },
      body: undefined,
    });
    expect(outputJson).toHaveBeenCalledWith({ id: "proj-1" });
  });

  it("matches a known route without path params", async () => {
    vi.mocked(rawRequest).mockResolvedValue({ projects: [] });

    await runHandler({ method: "GET", path: "/v1/projects" });

    expect(rawRequest).toHaveBeenCalledWith(expect.anything(), "GET", "/v1/projects", {
      pathParams: {},
      body: undefined,
    });
  });

  it("falls back to unmatched route for unknown paths", async () => {
    vi.mocked(rawRequest).mockResolvedValue({ ok: true });

    await runHandler({ method: "POST", path: "/v1/custom-endpoint" });

    expect(rawRequest).toHaveBeenCalledWith(expect.anything(), "POST", "/v1/custom-endpoint", {
      body: undefined,
    });
  });

  it("parses --data as JSON body", async () => {
    vi.mocked(rawRequest).mockResolvedValue({ created: true });

    await runHandler({
      method: "POST",
      path: "/v1/custom",
      data: '{"name":"test"}',
    });

    expect(rawRequest).toHaveBeenCalledWith(expect.anything(), "POST", "/v1/custom", {
      body: { name: "test" },
    });
  });

  it("exits with error on invalid JSON body", async () => {
    await expect(
      runHandler({
        method: "POST",
        path: "/v1/custom",
        data: "{invalid-json",
      }),
    ).rejects.toThrow("process.exit");

    expect(consola.error).toHaveBeenCalledWith("Invalid JSON body.");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("uppercases the HTTP method", async () => {
    vi.mocked(rawRequest).mockResolvedValue({});

    await runHandler({ method: "get", path: "/v1/projects" });

    expect(rawRequest).toHaveBeenCalledWith(
      expect.anything(),
      "GET",
      expect.any(String),
      expect.anything(),
    );
  });
});
