import { describe, expect, it, vi } from "vitest";

vi.mock("citty", () => ({
  defineCommand: vi.fn((def: Record<string, unknown>) => def),
}));

vi.mock("./login.js", () => ({ default: { meta: { name: "login" } } }));
vi.mock("./logout.js", () => ({ default: { meta: { name: "logout" } } }));
vi.mock("./list.js", () => ({ default: { meta: { name: "list" } } }));
vi.mock("./switch.js", () => ({ default: { meta: { name: "switch" } } }));
vi.mock("./status.js", () => ({ default: { meta: { name: "status" } } }));
vi.mock("../whoami.js", () => ({ default: { meta: { name: "whoami" } } }));

import authCommand from "./index.js";

describe("auth command", () => {
  it("has correct meta", () => {
    const meta = authCommand.meta as { name: string; description: string };
    expect(meta.name).toBe("auth");
    expect(meta.description).toBe("Manage authentication");
  });

  it("lazy-loads all subcommands", async () => {
    const subCmds = authCommand.subCommands as Record<string, () => Promise<unknown>>;
    const [login, logout, list, switchCmd, status, whoami] = await Promise.all([
      subCmds.login(),
      subCmds.logout(),
      subCmds.list(),
      subCmds.switch(),
      subCmds.status(),
      subCmds.whoami(),
    ]);
    expect(login).toEqual({ meta: { name: "login" } });
    expect(logout).toEqual({ meta: { name: "logout" } });
    expect(list).toEqual({ meta: { name: "list" } });
    expect(switchCmd).toEqual({ meta: { name: "switch" } });
    expect(status).toEqual({ meta: { name: "status" } });
    expect(whoami).toEqual({ meta: { name: "whoami" } });
  });
});
