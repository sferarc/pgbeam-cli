import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("citty", () => ({
  defineCommand: (config: Record<string, unknown>) => config,
}));

vi.mock("../lib/flags.js", () => ({
  globalArgs: {},
}));

vi.mock("@inquirer/prompts", () => ({
  select: vi.fn(),
}));

vi.mock("../lib/client.js", () => ({
  resolveContext: vi.fn(),
  requireOrg: vi.fn((ctx: { orgId: string | null }) => {
    if (!ctx.orgId) throw new Error("No organization set. Run `pgbeam orgs switch` or pass --org.");
    return ctx.orgId;
  }),
}));

vi.mock("../lib/errors.js", () => ({
  runCommand: vi.fn(async (fn: () => Promise<void>) => fn()),
}));

vi.mock("../lib/project.js", () => ({
  saveProjectLink: vi.fn(),
}));

vi.mock("consola", () => ({
  consola: { error: vi.fn(), warn: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

// Keep process.exit from terminating the test runner if a code path calls it.
vi.spyOn(process, "exit").mockImplementation(() => {
  throw new Error("process.exit");
});

import { select } from "@inquirer/prompts";
import { consola } from "consola";
import { resolveContext } from "../lib/client.js";
import { saveProjectLink } from "../lib/project.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mockListProjects = vi.fn();

function setupContext(orgId: string | null = "org-1") {
  vi.mocked(resolveContext).mockReturnValue({
    client: {
      projects: { listProjects: mockListProjects },
    },
    orgId,
    projectId: null,
  } as never);
}

async function runHandler(args: Record<string, unknown> = {}) {
  const mod = await import("./link.js");
  const command = mod.default;
  await command.run?.({ args: { json: false, "no-color": false, debug: false, ...args } } as never);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
});

describe("link", () => {
  it("fails when no organization is set", async () => {
    setupContext(null);

    // requireOrg throws; the real runCommand wrapper prints the message and
    // exits 1, the test mock lets the error propagate.
    await expect(runHandler()).rejects.toThrow("No organization set");
  });

  it("warns when no projects are found", async () => {
    setupContext();
    mockListProjects.mockResolvedValue({ projects: [] });

    await runHandler();

    expect(consola.warn).toHaveBeenCalledWith(expect.stringContaining("No projects found"));
    expect(saveProjectLink).not.toHaveBeenCalled();
  });

  it("prompts for project selection and saves the link", async () => {
    setupContext();
    mockListProjects.mockResolvedValue({
      projects: [
        { id: "proj-1", name: "My Project" },
        { id: "proj-2", name: "Other Project" },
      ],
    });
    vi.mocked(select).mockResolvedValue("proj-1");

    await runHandler();

    expect(select).toHaveBeenCalledWith({
      message: "Select a project to link:",
      choices: [
        { name: "My Project (proj-1)", value: "proj-1" },
        { name: "Other Project (proj-2)", value: "proj-2" },
      ],
    });
    expect(saveProjectLink).toHaveBeenCalledWith({ projectId: "proj-1", orgId: "org-1" });
    expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("proj-1"));
  });

  it("passes org_id to listProjects query", async () => {
    setupContext("org-abc");
    mockListProjects.mockResolvedValue({ projects: [] });

    await runHandler();

    expect(mockListProjects).toHaveBeenCalledWith({
      queryParams: { org_id: "org-abc" },
    });
  });
});
