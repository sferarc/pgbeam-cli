import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("consola", () => ({
  consola: {
    error: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
  },
}));

vi.mock("./output.js", () => ({
  outputJson: vi.fn(),
}));

import { consola } from "consola";
import { ConfirmationDeclinedError } from "./confirm";
import { remediationHint, runCommand } from "./errors";
import { outputJson } from "./output.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit");
  });
});

describe("runCommand", () => {
  it("executes the function successfully without logging or exiting", async () => {
    const fn = vi.fn(async () => {});

    // runCommand should not throw when fn succeeds
    await runCommand(fn);

    expect(fn).toHaveBeenCalledOnce();
    expect(consola.error).not.toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
  });

  it("handles API errors with a status property", async () => {
    const apiError = Object.assign(new Error("Not Found"), { status: 404 });

    await expect(
      runCommand(async () => {
        throw apiError;
      }),
    ).rejects.toThrow("process.exit");

    expect(consola.error).toHaveBeenCalledWith("API error (404): Not Found");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("prints a remediation hint for common statuses", async () => {
    await expect(
      runCommand(async () => {
        throw Object.assign(new Error("Unauthorized"), { status: 401 });
      }),
    ).rejects.toThrow("process.exit");

    expect(consola.info).toHaveBeenCalledWith(expect.stringContaining("pgbeam auth login"));
  });

  it("handles plain Error instances", async () => {
    await expect(
      runCommand(async () => {
        throw new Error("Something went wrong");
      }),
    ).rejects.toThrow("process.exit");

    expect(consola.error).toHaveBeenCalledWith("Something went wrong");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("handles non-Error objects with a status property", async () => {
    await expect(
      runCommand(async () => {
        throw { status: 500, message: "server error" };
      }),
    ).rejects.toThrow("process.exit");

    expect(consola.error).toHaveBeenCalledWith(expect.stringContaining("API error (500)"));
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("handles string errors", async () => {
    await expect(
      runCommand(async () => {
        throw "raw string error";
      }),
    ).rejects.toThrow("process.exit");

    expect(consola.error).toHaveBeenCalledWith("raw string error");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("handles null/undefined errors", async () => {
    await expect(
      runCommand(async () => {
        throw null;
      }),
    ).rejects.toThrow("process.exit");

    // null gets stringified
    expect(consola.error).toHaveBeenCalledWith("null");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("treats a declined confirmation as a clean cancel (info, no exit)", async () => {
    await runCommand(async () => {
      throw new ConfirmationDeclinedError();
    });

    expect(consola.info).toHaveBeenCalledWith("Cancelled.");
    expect(consola.error).not.toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
  });

  it("treats an aborted prompt (Ctrl-C) as a clean cancel", async () => {
    await runCommand(async () => {
      throw Object.assign(new Error("aborted"), { name: "ExitPromptError" });
    });

    expect(consola.info).toHaveBeenCalledWith("Cancelled.");
    expect(consola.error).not.toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
  });

  it("displays the response body when the error carries one with extra detail", async () => {
    const apiError = Object.assign(new Error("Invalid policy"), {
      status: 400,
      body: { error: { code: "INVALID_ARGUMENT", message: "Invalid policy" } },
    });

    await expect(
      runCommand(async () => {
        throw apiError;
      }),
    ).rejects.toThrow("process.exit");

    expect(consola.error).toHaveBeenCalledWith("API error (400): Invalid policy");
    expect(consola.log).toHaveBeenCalledWith(expect.stringContaining("INVALID_ARGUMENT"));
  });

  it("does not repeat a body that only contains the already-printed message", async () => {
    const apiError = Object.assign(new Error("Project not found"), {
      status: 404,
      body: { message: "Project not found" },
    });

    await expect(
      runCommand(async () => {
        throw apiError;
      }),
    ).rejects.toThrow("process.exit");

    expect(consola.error).toHaveBeenCalledWith("API error (404): Project not found");
    expect(consola.log).not.toHaveBeenCalled();
  });

  describe("with --json", () => {
    let argvBackup: string[];

    beforeEach(() => {
      argvBackup = process.argv;
      process.argv = [...process.argv, "--json"];
    });

    afterEach(() => {
      process.argv = argvBackup;
    });

    it("emits a machine-parseable error object for API errors", async () => {
      const apiError = Object.assign(new Error("Unauthorized"), { status: 401 });

      await expect(
        runCommand(async () => {
          throw apiError;
        }),
      ).rejects.toThrow("process.exit");

      expect(outputJson).toHaveBeenCalledWith({
        error: {
          status: 401,
          message: "Unauthorized",
          hint: expect.stringContaining("pgbeam auth login"),
        },
      });
      expect(consola.error).not.toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it("emits a status-less error object for plain errors", async () => {
      await expect(
        runCommand(async () => {
          throw new Error("Could not read --file ./missing.json");
        }),
      ).rejects.toThrow("process.exit");

      expect(outputJson).toHaveBeenCalledWith({
        error: { message: "Could not read --file ./missing.json" },
      });
      expect(consola.error).not.toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });
});

describe("remediationHint", () => {
  it("covers the common statuses", () => {
    expect(remediationHint(401)).toContain("pgbeam auth login");
    expect(remediationHint(403)).toContain("pgbeam auth status");
    expect(remediationHint(404)).toContain("pgbeam link");
    expect(remediationHint(429)).toContain("retry");
    expect(remediationHint(500)).toContain("Retry shortly");
    expect(remediationHint(503)).toContain("Retry shortly");
  });

  it("returns undefined for statuses without a hint", () => {
    expect(remediationHint(400)).toBeUndefined();
    expect(remediationHint(409)).toBeUndefined();
  });
});
