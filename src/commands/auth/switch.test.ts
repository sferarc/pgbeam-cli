import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@inquirer/prompts", () => ({
  select: vi.fn(),
}));

vi.mock("consola", () => ({
  consola: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    log: vi.fn(),
  },
}));

vi.mock("../../lib/config.js", () => ({
  listProfiles: vi.fn(),
  switchProfile: vi.fn(),
}));

import { select } from "@inquirer/prompts";
import { consola } from "consola";
import { listProfiles, switchProfile } from "../../lib/config.js";
import switchCommand from "./switch.js";

const run = switchCommand.run;
if (!run) throw new Error("command.run is not defined");

describe("auth switch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("switches to named profile when positional arg is provided", async () => {
    vi.mocked(switchProfile).mockReturnValue(true);

    await run({
      args: { name: "production", json: false, "no-color": false, debug: false },
    } as never);

    expect(switchProfile).toHaveBeenCalledWith("production");
    expect(consola.success).toHaveBeenCalledWith('Switched to profile "production".');
  });

  it("exits with error when named profile does not exist", async () => {
    vi.mocked(switchProfile).mockReturnValue(false);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await run({
      args: { name: "nonexistent", json: false, "no-color": false, debug: false },
    } as never);

    expect(consola.error).toHaveBeenCalledWith('Profile "nonexistent" not found.');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("prompts with profile list when no name argument", async () => {
    vi.mocked(listProfiles).mockReturnValue([
      { name: "default", profile: { method: "api-key", token: "tok1" }, active: true },
      { name: "staging", profile: { method: "api-key", token: "tok2" }, active: false },
    ]);
    vi.mocked(select).mockResolvedValue("staging");
    vi.mocked(switchProfile).mockReturnValue(true);

    await run({
      args: { name: undefined, json: false, "no-color": false, debug: false },
    } as never);

    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Select profile:",
        choices: expect.arrayContaining([
          expect.objectContaining({ value: "default" }),
          expect.objectContaining({ value: "staging" }),
        ]),
      }),
    );
    expect(switchProfile).toHaveBeenCalledWith("staging");
  });

  it("shows error when no profiles and no name arg", async () => {
    vi.mocked(listProfiles).mockReturnValue([]);

    await run({
      args: { name: undefined, json: false, "no-color": false, debug: false },
    } as never);

    expect(consola.error).toHaveBeenCalledWith(
      "No profiles configured. Run `pgbeam auth login` first.",
    );
    expect(select).not.toHaveBeenCalled();
  });

  it("treats boolean name arg as undefined (prompts instead)", async () => {
    vi.mocked(listProfiles).mockReturnValue([
      { name: "default", profile: { method: "api-key", token: "tok" }, active: true },
    ]);
    vi.mocked(select).mockResolvedValue("default");
    vi.mocked(switchProfile).mockReturnValue(true);

    await run({
      args: { name: true, json: false, "no-color": false, debug: false },
    } as never);

    expect(select).toHaveBeenCalled();
  });
});
