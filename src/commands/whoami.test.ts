import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks (needed for auth/status.ts transitively imported by whoami.ts)
// ---------------------------------------------------------------------------
vi.mock("citty", () => ({
  defineCommand: (config: Record<string, unknown>) => config,
}));

vi.mock("../lib/flags.js", () => ({
  globalArgs: {},
}));

vi.mock("../lib/config.js", () => ({
  loadAuthConfig: vi.fn(),
  getCurrentProfile: vi.fn(),
  getProfile: vi.fn(),
}));

vi.mock("../lib/client.js", () => ({
  resolveAuthState: vi.fn(),
}));

vi.mock("../lib/orgs.js", () => ({
  errorStatus: vi.fn(() => null),
  fetchOrganizations: vi.fn(),
}));

vi.mock("../lib/output.js", () => ({
  output: vi.fn(),
}));

vi.mock("consola", () => ({
  consola: { log: vi.fn(), warn: vi.fn() },
}));

// whoami.ts wraps auth/status with its own meta so `pgbeam whoami --help`
// shows "whoami" rather than the alias target's name (QA finding CLI-13).

describe("whoami", () => {
  it("has its own meta name instead of reusing the status name", async () => {
    const whoami = await import("./whoami.js");
    const meta = (whoami.default as { meta: { name: string } }).meta;
    expect(meta.name).toBe("whoami");
  });

  it("keeps the status description", async () => {
    const whoami = await import("./whoami.js");
    const meta = (whoami.default as { meta: { description: string } }).meta;
    expect(meta.description).toBe("Show current authentication status");
  });

  it("reuses the auth/status implementation and args", async () => {
    const whoami = await import("./whoami.js");
    const status = await import("./auth/status.js");

    const whoamiCmd = whoami.default as { run: unknown; args: unknown };
    const statusCmd = status.default as { run: unknown; args: unknown };
    expect(whoamiCmd.run).toBe(statusCmd.run);
    expect(whoamiCmd.args).toBe(statusCmd.args);
  });
});
