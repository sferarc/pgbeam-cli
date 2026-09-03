import { beforeEach, describe, expect, it, vi } from "vitest";

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
}));

vi.mock("../../lib/output.js", () => ({
  output: vi.fn((data, json, tableFn) => {
    void data;
    if (json) return;
    if (tableFn) tableFn();
  }),
  outputTable: vi.fn(),
}));

import { consola } from "consola";
import { listProfiles } from "../../lib/config.js";
import { output, outputTable } from "../../lib/output.js";
import listCommand from "./list.js";

const run = listCommand.run;
if (!run) throw new Error("command.run is not defined");

describe("auth list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows info message when no profiles exist", async () => {
    vi.mocked(listProfiles).mockReturnValue([]);

    await run({ args: { json: false, "no-color": false, debug: false } } as never);

    expect(output).toHaveBeenCalledWith([], false, expect.any(Function));
    expect(consola.info).toHaveBeenCalledWith(
      "No profiles configured. Run `pgbeam auth login` to get started.",
    );
  });

  it("outputs JSON when --json flag with no profiles", async () => {
    vi.mocked(listProfiles).mockReturnValue([]);

    // Reset mock to use identity behavior for json mode
    vi.mocked(output).mockImplementation((data, json, tableFn) => {
      void data;
      if (json) return;
      if (tableFn) tableFn();
    });

    await run({ args: { json: true, "no-color": false, debug: false } } as never);

    expect(output).toHaveBeenCalledWith([], true, expect.any(Function));
  });

  it("displays table of profiles when profiles exist", async () => {
    const profiles = [
      {
        name: "default",
        profile: { method: "api-key" as const, token: "tok1", orgId: "org_1", email: "a@b.com" },
        active: true,
      },
      { name: "staging", profile: { method: "api-key" as const, token: "tok2" }, active: false },
    ];
    vi.mocked(listProfiles).mockReturnValue(profiles);

    await run({ args: { json: false, "no-color": false, debug: false } } as never);

    expect(output).toHaveBeenCalledWith(profiles, false, expect.any(Function));
    expect(outputTable).toHaveBeenCalledWith(
      [
        { active: "*", name: "default", method: "api-key", org: "org_1", email: "a@b.com" },
        { active: "", name: "staging", method: "api-key", org: "-", email: "-" },
      ],
      [
        { key: "active", label: "" },
        { key: "name", label: "Profile" },
        { key: "method", label: "Method" },
        { key: "org", label: "Org" },
        { key: "email", label: "Email" },
      ],
    );
  });
});
