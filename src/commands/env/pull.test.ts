import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  input: vi.fn(),
}));

vi.mock("consola", () => ({
  consola: {
    success: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
  },
}));

vi.mock("../../lib/client.js", () => ({
  resolveContext: vi.fn(),
  requireProject: vi.fn(),
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
const originalIsTTY = process.stdin.isTTY;

function setTTY(value: boolean) {
  Object.defineProperty(process.stdin, "isTTY", { value, configurable: true });
}

const NEW_LINE = 'DATABASE_URL="postgresql://USER:PASS@proxy.pgbeam.com:5432/YOUR_DB"';

function written(): string {
  return vi.mocked(writeFileSync).mock.calls[0][1] as string;
}

function givenFile(content: string) {
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readFileSync).mockReturnValue(content);
}

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
  mockClient.projects.getProject.mockResolvedValue({ proxy_host: "proxy.pgbeam.com" });
  setTTY(true);
});

afterEach(() => {
  setTTY(originalIsTTY);
});

describe("env pull", () => {
  it("creates a new .env file when none exists", async () => {
    mockClient.projects.getProject.mockResolvedValue({
      proxy_host: "proxy.pgbeam.com",
    });
    vi.mocked(existsSync).mockReturnValue(false);

    await pullCommand.run?.({ args: buildArgs() } as never);

    expect(writeFileSync).toHaveBeenCalledWith(".env", `${NEW_LINE}\n`, { mode: 0o600 });
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

    expect(written()).toBe(`API_KEY=abc123\n${NEW_LINE}\n`);
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
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("appends without prompting when only a key ending in DATABASE_URL exists", async () => {
    givenFile('DIRECT_DATABASE_URL="postgresql://direct"\nPOOLED_DATABASE_URL="x"\n');

    await pullCommand.run?.({ args: buildArgs() } as never);

    expect(confirm).not.toHaveBeenCalled();
    expect(written()).toBe(
      `DIRECT_DATABASE_URL="postgresql://direct"\nPOOLED_DATABASE_URL="x"\n${NEW_LINE}\n`,
    );
  });

  it("replaces an exported DATABASE_URL and keeps the export prefix", async () => {
    givenFile('A=1\nexport DATABASE_URL="postgresql://old"\nB=2\n');

    await pullCommand.run?.({ args: buildArgs({ yes: true }) } as never);

    expect(written()).toBe(`A=1\nexport ${NEW_LINE}\nB=2\n`);
  });

  it("replaces a DATABASE_URL with whitespace around the equals sign", async () => {
    givenFile('  DATABASE_URL = "postgresql://old"\n');

    await pullCommand.run?.({ args: buildArgs({ yes: true }) } as never);

    expect(written()).toBe(`  ${NEW_LINE}\n`);
  });

  it("replaces every duplicate DATABASE_URL line and warns", async () => {
    givenFile('DATABASE_URL="one"\nX=1\nDATABASE_URL="two"\n');

    await pullCommand.run?.({ args: buildArgs({ yes: true }) } as never);

    expect(written()).toBe(`${NEW_LINE}\nX=1\n${NEW_LINE}\n`);
    expect(consola.warn).toHaveBeenCalledWith(
      ".env had 2 DATABASE_URL lines; all of them were replaced.",
    );
  });

  it("does not expand $ patterns from the proxy host", async () => {
    mockClient.projects.getProject.mockResolvedValue({ proxy_host: "h$&$1.example" });
    givenFile('DATABASE_URL="old"\n');

    await pullCommand.run?.({ args: buildArgs({ yes: true }) } as never);

    expect(written()).toBe('DATABASE_URL="postgresql://USER:PASS@h$&$1.example:5432/YOUR_DB"\n');
  });

  it("fails without touching the file when not a TTY and --yes is missing", async () => {
    setTTY(false);
    givenFile('DATABASE_URL="old"\n');

    await pullCommand.run?.({ args: buildArgs() } as never);

    expect(confirm).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("--yes"));
    expect(exitSpy).toHaveBeenCalledWith(1);
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

    expect(writeFileSync).toHaveBeenCalledWith(".env.local", `${NEW_LINE}\n`, { mode: 0o600 });
    expect(consola.success).toHaveBeenCalledWith("Wrote DATABASE_URL to .env.local");
  });
});
