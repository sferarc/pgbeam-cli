import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
}));

vi.mock("consola", () => ({
  consola: {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../lib/client.js", () => ({
  resolveContext: vi.fn(),
  requireProject: vi.fn(),
}));

vi.mock("../../lib/errors.js", () => ({
  runCommand: vi.fn(async (fn: () => Promise<void>) => fn()),
}));

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { confirm } from "@inquirer/prompts";
import { consola } from "consola";
import { requireProject, resolveContext } from "../../lib/client.js";
import pullCommand from "./pull.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mockClient = {
  projects: {
    getProject: vi.fn(),
  },
};

const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

function buildArgs(overrides: Record<string, unknown> = {}) {
  return {
    json: false,
    "no-color": false,
    debug: false,
    file: ".env",
    yes: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveContext).mockReturnValue({
    client: mockClient as never,
    orgId: "org-1",
    projectId: "proj-1",
  });
  vi.mocked(requireProject).mockReturnValue("proj-1");
});

describe("env pull", () => {
  it("creates a new .env file when none exists", async () => {
    mockClient.projects.getProject.mockResolvedValue({
      proxy_host: "proxy.pgbeam.com",
    });
    vi.mocked(existsSync).mockReturnValue(false);

    await pullCommand.run?.({ args: buildArgs() } as never);

    expect(writeFileSync).toHaveBeenCalledWith(
      ".env",
      'DATABASE_URL="postgresql://USER:PASS@proxy.pgbeam.com:5432/YOUR_DB"\n',
    );
    expect(consola.success).toHaveBeenCalledWith("Wrote DATABASE_URL to .env");
    expect(consola.info).toHaveBeenCalledWith(
      "Replace USER, PASS, and YOUR_DB with your upstream credentials.",
    );
  });

  it("appends to existing .env file without DATABASE_URL", async () => {
    mockClient.projects.getProject.mockResolvedValue({
      proxy_host: "proxy.pgbeam.com",
    });
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue("API_KEY=abc123\n");

    await pullCommand.run?.({ args: buildArgs() } as never);

    expect(writeFileSync).toHaveBeenCalledWith(
      ".env",
      'API_KEY=abc123\nDATABASE_URL="postgresql://USER:PASS@proxy.pgbeam.com:5432/YOUR_DB"\n',
    );
  });

  it("replaces existing DATABASE_URL with --yes flag", async () => {
    mockClient.projects.getProject.mockResolvedValue({
      proxy_host: "proxy.pgbeam.com",
    });
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      'API_KEY=abc\nDATABASE_URL="postgresql://old"\nOTHER=x\n',
    );

    await pullCommand.run?.({ args: buildArgs({ yes: true }) } as never);

    expect(confirm).not.toHaveBeenCalled();
    const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(written).toContain(
      'DATABASE_URL="postgresql://USER:PASS@proxy.pgbeam.com:5432/YOUR_DB"',
    );
    expect(written).toContain("API_KEY=abc");
    expect(written).toContain("OTHER=x");
  });

  it("prompts for confirmation when overwriting DATABASE_URL", async () => {
    mockClient.projects.getProject.mockResolvedValue({
      proxy_host: "proxy.pgbeam.com",
    });
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('DATABASE_URL="old"\n');
    vi.mocked(confirm).mockResolvedValue(true);

    await pullCommand.run?.({ args: buildArgs() } as never);

    expect(confirm).toHaveBeenCalledWith({
      message: ".env already contains DATABASE_URL. Overwrite?",
      default: false,
    });
    expect(writeFileSync).toHaveBeenCalled();
  });

  it("cancels when user declines overwrite", async () => {
    mockClient.projects.getProject.mockResolvedValue({
      proxy_host: "proxy.pgbeam.com",
    });
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('DATABASE_URL="old"\n');
    vi.mocked(confirm).mockResolvedValue(false);

    await pullCommand.run?.({ args: buildArgs() } as never);

    expect(writeFileSync).not.toHaveBeenCalled();
    expect(consola.info).toHaveBeenCalledWith("Cancelled.");
  });

  it("exits with error when project has no proxy host", async () => {
    mockClient.projects.getProject.mockResolvedValue({
      proxy_host: null,
    });

    await pullCommand.run?.({ args: buildArgs() } as never);

    expect(consola.error).toHaveBeenCalledWith("Project has no proxy host configured.");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("uses custom file path", async () => {
    mockClient.projects.getProject.mockResolvedValue({
      proxy_host: "proxy.pgbeam.com",
    });
    vi.mocked(existsSync).mockReturnValue(false);

    await pullCommand.run?.({ args: buildArgs({ file: ".env.local" }) } as never);

    expect(writeFileSync).toHaveBeenCalledWith(
      ".env.local",
      'DATABASE_URL="postgresql://USER:PASS@proxy.pgbeam.com:5432/YOUR_DB"\n',
    );
    expect(consola.success).toHaveBeenCalledWith("Wrote DATABASE_URL to .env.local");
  });
});
