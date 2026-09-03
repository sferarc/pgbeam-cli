import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
  input: vi.fn(),
}));

import { confirm, input } from "@inquirer/prompts";
import {
  ConfirmationDeclinedError,
  ConfirmationMismatchError,
  ConfirmationRequiredError,
  confirmDestructive,
} from "./confirm.js";

describe("confirmDestructive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("--yes flag", () => {
    it("skips the prompt entirely", async () => {
      await expect(
        confirmDestructive({ yes: true, message: "Delete?", isTTY: true }),
      ).resolves.toBeUndefined();
      expect(confirm).not.toHaveBeenCalled();
      expect(input).not.toHaveBeenCalled();
    });

    it("bypasses a name-match requirement (scripting)", async () => {
      await expect(
        confirmDestructive({
          yes: true,
          message: "Delete project prj_1?",
          requireMatch: "prj_1",
          isTTY: false,
        }),
      ).resolves.toBeUndefined();
      expect(input).not.toHaveBeenCalled();
    });
  });

  describe("non-interactive (no TTY) without --yes", () => {
    it("refuses with ConfirmationRequiredError, never prompting", async () => {
      await expect(
        confirmDestructive({ yes: false, message: "Delete?", action: "Delete", isTTY: false }),
      ).rejects.toBeInstanceOf(ConfirmationRequiredError);
      expect(confirm).not.toHaveBeenCalled();
    });

    it("error message points the user at --yes", async () => {
      await expect(
        confirmDestructive({ yes: false, message: "Delete?", action: "Revoke", isTTY: false }),
      ).rejects.toThrowError(/--yes/);
    });

    it("refuses a name-match command too, never prompting", async () => {
      await expect(
        confirmDestructive({
          yes: false,
          message: "Delete project?",
          requireMatch: "prj_1",
          isTTY: false,
        }),
      ).rejects.toBeInstanceOf(ConfirmationRequiredError);
      expect(input).not.toHaveBeenCalled();
    });
  });

  describe("interactive confirm prompt", () => {
    it("resolves when the user confirms", async () => {
      vi.mocked(confirm).mockResolvedValue(true);
      await expect(
        confirmDestructive({ yes: false, message: "Delete db_1?", isTTY: true }),
      ).resolves.toBeUndefined();
      expect(confirm).toHaveBeenCalledWith({ message: "Delete db_1?", default: false });
    });

    it("throws ConfirmationDeclinedError when the user declines", async () => {
      vi.mocked(confirm).mockResolvedValue(false);
      await expect(
        confirmDestructive({ yes: false, message: "Delete db_1?", isTTY: true }),
      ).rejects.toBeInstanceOf(ConfirmationDeclinedError);
    });
  });

  describe("interactive name-match prompt", () => {
    it("resolves when the typed value matches exactly", async () => {
      vi.mocked(input).mockResolvedValue("prj_1");
      await expect(
        confirmDestructive({
          yes: false,
          message: "Delete project prj_1?",
          requireMatch: "prj_1",
          isTTY: true,
        }),
      ).resolves.toBeUndefined();
      expect(confirm).not.toHaveBeenCalled();
    });

    it("trims surrounding whitespace before matching", async () => {
      vi.mocked(input).mockResolvedValue("  prj_1  ");
      await expect(
        confirmDestructive({
          yes: false,
          message: "Delete project prj_1?",
          requireMatch: "prj_1",
          isTTY: true,
        }),
      ).resolves.toBeUndefined();
    });

    it("throws ConfirmationMismatchError when the typed value differs", async () => {
      vi.mocked(input).mockResolvedValue("wrong");
      await expect(
        confirmDestructive({
          yes: false,
          message: "Delete project prj_1?",
          requireMatch: "prj_1",
          isTTY: true,
        }),
      ).rejects.toBeInstanceOf(ConfirmationMismatchError);
    });
  });
});
