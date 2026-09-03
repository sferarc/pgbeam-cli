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

vi.mock("../lib/project.js", () => ({
  removeProjectLink: vi.fn(),
}));

vi.mock("consola", () => ({
  consola: { success: vi.fn(), warn: vi.fn() },
}));

import { consola } from "consola";
import { removeProjectLink } from "../lib/project.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function runHandler() {
  const mod = await import("./unlink.js");
  const command = mod.default;
  await command.run?.({ args: { json: false, "no-color": false, debug: false } } as never);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
});

describe("unlink", () => {
  it("logs success when project link is removed", async () => {
    vi.mocked(removeProjectLink).mockReturnValue(true);

    await runHandler();

    expect(removeProjectLink).toHaveBeenCalledOnce();
    expect(consola.success).toHaveBeenCalledWith("Project unlinked.");
  });

  it("logs warning when no project link exists", async () => {
    vi.mocked(removeProjectLink).mockReturnValue(false);

    await runHandler();

    expect(removeProjectLink).toHaveBeenCalledOnce();
    expect(consola.warn).toHaveBeenCalledWith("No project linked in current directory.");
  });
});
