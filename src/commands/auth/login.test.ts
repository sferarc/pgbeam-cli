import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@inquirer/prompts", () => ({
  select: vi.fn(),
  input: vi.fn(),
  password: vi.fn(),
}));

vi.mock("../../lib/errors.js", () => ({
  runCommand: (fn: () => Promise<void>) => fn(),
}));

vi.mock("../../lib/auth.js", () => ({
  loginWithApiKey: vi.fn(),
}));

import { select } from "@inquirer/prompts";
import { loginWithApiKey } from "../../lib/auth.js";
import loginCommand from "./login.js";

const run = loginCommand.run;
if (!run) throw new Error("command.run is not defined");

describe("auth login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("goes straight to the API key flow without a method menu", async () => {
    await run({
      args: { "api-key": false, json: false, "no-color": false, debug: false },
    } as never);

    expect(loginWithApiKey).toHaveBeenCalledWith({
      profile: undefined,
      org: undefined,
      withToken: undefined,
      json: false,
    });
    expect(select).not.toHaveBeenCalled();
  });

  it("passes the profile through to loginWithApiKey", async () => {
    await run({
      args: {
        "api-key": false,
        profile: "myprofile",
        json: false,
        "no-color": false,
        debug: false,
      },
    } as never);

    expect(loginWithApiKey).toHaveBeenCalledWith(expect.objectContaining({ profile: "myprofile" }));
  });

  it("passes --with-token, --org and --json through", async () => {
    await run({
      args: {
        "api-key": false,
        "with-token": true,
        profile: "ci",
        org: "org_123",
        json: true,
        "no-color": false,
        debug: false,
      },
    } as never);

    expect(loginWithApiKey).toHaveBeenCalledWith({
      profile: "ci",
      org: "org_123",
      withToken: true,
      json: true,
    });
  });

  it("still accepts the legacy --api-key flag", async () => {
    await run({
      args: { "api-key": true, profile: "myprofile", json: false, "no-color": false, debug: false },
    } as never);

    expect(loginWithApiKey).toHaveBeenCalledWith(expect.objectContaining({ profile: "myprofile" }));
    expect(select).not.toHaveBeenCalled();
  });
});
