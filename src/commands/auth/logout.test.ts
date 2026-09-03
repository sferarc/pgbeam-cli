import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
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
  loadAuthConfig: vi.fn(),
  removeProfile: vi.fn(),
  saveAuthConfig: vi.fn(),
}));

import { confirm } from "@inquirer/prompts";
import { consola } from "consola";
import { loadAuthConfig, removeProfile, saveAuthConfig } from "../../lib/config.js";
import logoutCommand from "./logout.js";

const run = logoutCommand.run;
if (!run) throw new Error("command.run is not defined");

describe("auth logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("--all flag", () => {
    it("removes all profiles with --yes", async () => {
      await run({
        args: { all: true, yes: true, json: false, "no-color": false, debug: false },
      } as never);

      expect(saveAuthConfig).toHaveBeenCalledWith({ currentProfile: "", profiles: {} });
      expect(consola.success).toHaveBeenCalledWith("All profiles removed.");
    });

    it("prompts for confirmation without --yes", async () => {
      vi.mocked(confirm).mockResolvedValue(true);

      await run({
        args: { all: true, yes: false, json: false, "no-color": false, debug: false },
      } as never);

      expect(confirm).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Remove all authentication profiles?" }),
      );
      expect(saveAuthConfig).toHaveBeenCalledWith({ currentProfile: "", profiles: {} });
    });

    it("cancels when user declines confirmation", async () => {
      vi.mocked(confirm).mockResolvedValue(false);

      await run({
        args: { all: true, yes: false, json: false, "no-color": false, debug: false },
      } as never);

      expect(consola.info).toHaveBeenCalledWith("Cancelled.");
      expect(saveAuthConfig).not.toHaveBeenCalled();
    });
  });

  describe("single profile", () => {
    it("removes the specified profile by --profile arg", async () => {
      vi.mocked(loadAuthConfig).mockReturnValue({
        currentProfile: "default",
        profiles: { myprofile: { method: "api-key", token: "tok" } },
      });

      await run({
        args: {
          all: false,
          yes: false,
          profile: "myprofile",
          json: false,
          "no-color": false,
          debug: false,
        },
      } as never);

      expect(removeProfile).toHaveBeenCalledWith("myprofile");
      expect(consola.success).toHaveBeenCalledWith('Profile "myprofile" removed.');
    });

    it("removes the current profile when no --profile arg", async () => {
      vi.mocked(loadAuthConfig).mockReturnValue({
        currentProfile: "default",
        profiles: { default: { method: "api-key", token: "tok" } },
      });

      await run({
        args: { all: false, yes: false, json: false, "no-color": false, debug: false },
      } as never);

      expect(removeProfile).toHaveBeenCalledWith("default");
    });

    it("exits with error when no profile exists", async () => {
      vi.mocked(loadAuthConfig).mockReturnValue({
        currentProfile: "",
        profiles: {},
      });

      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

      await run({
        args: { all: false, yes: false, json: false, "no-color": false, debug: false },
      } as never);

      expect(consola.error).toHaveBeenCalledWith("No profile to remove.");
      expect(exitSpy).toHaveBeenCalledWith(1);
      exitSpy.mockRestore();
    });
  });
});
