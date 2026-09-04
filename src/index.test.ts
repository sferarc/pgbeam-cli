import { describe, expect, it, vi } from "vitest";

vi.mock("citty", () => ({
  defineCommand: vi.fn((def: Record<string, unknown>) => def),
  runMain: vi.fn(),
  renderUsage: vi.fn(async () => "usage"),
}));

vi.mock("consola", () => ({
  consola: { level: 3 },
}));

vi.mock("./lib/constants.js", () => ({
  VERSION: "0.0.0-test",
}));

vi.mock("./lib/flags.js", () => ({
  globalArgs: {
    "no-color": { type: "boolean", description: "Disable color" },
    debug: { type: "boolean", description: "Enable debug" },
  },
}));

vi.mock("./lib/upgrade-notifier.js", () => ({
  checkForUpdates: vi.fn().mockResolvedValue(undefined),
}));

// Import after mocks are set up
import { defineCommand, runMain } from "citty";
import { checkForUpdates } from "./lib/upgrade-notifier.js";

await import("./index.js");

const defineCommandMock = vi.mocked(defineCommand);
const runMainMock = vi.mocked(runMain);

/**
 * What `index.js` itself did, captured the moment it finished loading and before
 * anything below reaches into the command tree.
 *
 * Loading a subcommand module calls the mocked `defineCommand` again, so reading
 * the mock inside the tests only ever worked because the one test that resolved
 * the loaders happened to run last. That is an ordering the file did not state
 * and could not enforce; snapshotting here makes the assertions independent of
 * what else has been imported by the time they run.
 */
const rootDefineCalls = defineCommandMock.mock.calls.length;
const rootDefinition = defineCommandMock.mock.calls[0][0] as Record<string, unknown>;
const rootCommand: unknown = defineCommandMock.mock.results[0].value;

/**
 * Call every subcommand loader once, here at module scope, and settle what they
 * return.
 *
 * Each loader is a dynamic import, and between them they pull in the CLI's whole
 * command graph: every command module, the generated manifest, and the SDK.
 * Under `pnpm test:frontend` that load is Vite-transformed and
 * v8-coverage-instrumented while 364 other test files compete for the same
 * cores, and it has been measured at 1.7s under partial load against 0.14s in
 * isolation. Awaiting it inside an `it()` therefore put vitest's 5s per-test
 * timeout around compiler throughput rather than around the thing being
 * asserted, and the test passed or failed with machine load.
 *
 * Module evaluation is covered by neither `testTimeout` nor `hookTimeout`, so
 * doing it in top-level await removes that clock instead of enlarging it. The
 * test below then only inspects what came back.
 *
 * Rejections are tolerated for the reason they always were: this file mocks
 * citty and consola but not the many modules the commands themselves reach for,
 * so some of these imports do not resolve here. `tree.test.ts` is what asserts
 * that every command really is reachable.
 */
const loaderCalls = Object.entries(rootDefinition.subCommands as Record<string, () => unknown>).map(
  ([name, loader]) => ({ name, returned: loader() }),
);

await Promise.allSettled(
  loaderCalls
    .map(({ returned }) => returned)
    .filter((returned): returned is Promise<unknown> => returned instanceof Promise),
);

describe("CLI main entry (index.ts)", () => {
  it("calls defineCommand with pgbeam meta", () => {
    expect(rootDefineCalls, "index.ts should define exactly one command").toBe(1);

    const meta = rootDefinition.meta as { name: string; version: string; description: string };

    expect(meta.name).toBe("pgbeam");
    expect(meta.version).toBe("0.0.0-test");
    expect(meta.description).toBe("PgBeam CLI, manage your PostgreSQL proxy platform");
  });

  it("registers all top-level subcommands", () => {
    const subCmds = Object.keys(rootDefinition.subCommands as Record<string, unknown>);

    expect(subCmds).toEqual([
      "auth",
      "whoami",
      "projects",
      "link",
      "unlink",
      "db",
      "domains",
      "replicas",
      "cache-rules",
      "env",
      "agents",
      "policies",
      "annotations",
      "audit",
      "approvals",
      "anomalies",
      "honeytokens",
      "webhooks",
      "branches",
      "migrations",
      "orgs",
      "analytics",
      "account",
      "api",
      "platform",
      "mcp",
      "doctor",
      "update",
    ]);
  });

  it("has lazy-loaded subcommands (functions)", () => {
    const subCmds = rootDefinition.subCommands as Record<string, unknown>;

    for (const loader of Object.values(subCmds)) {
      expect(typeof loader).toBe("function");
    }
  });

  it("includes globalArgs in args", () => {
    const args = rootDefinition.args as Record<string, unknown>;

    expect(args).toHaveProperty("no-color");
    expect(args).toHaveProperty("debug");
  });

  it("defines a setup function", () => {
    expect(typeof rootDefinition.setup).toBe("function");
  });

  it("setup sets NO_COLOR env when --no-color is passed", () => {
    const setup = rootDefinition.setup as (ctx: { args: Record<string, boolean> }) => void;

    const originalNoColor = process.env.NO_COLOR;
    try {
      delete process.env.NO_COLOR;
      setup({ args: { "no-color": true, debug: false } });
      expect(process.env.NO_COLOR).toBe("1");
    } finally {
      if (originalNoColor !== undefined) {
        process.env.NO_COLOR = originalNoColor;
      } else {
        delete process.env.NO_COLOR;
      }
    }
  });

  it("setup sets consola.level to 5 when --debug is passed", async () => {
    const { consola } = await import("consola");
    const setup = rootDefinition.setup as (ctx: { args: Record<string, boolean> }) => void;

    consola.level = 3;
    setup({ args: { "no-color": false, debug: true } });
    expect(consola.level).toBe(5);
  });

  it("calls runMain with the command definition and the examples-aware help renderer", () => {
    expect(runMainMock).toHaveBeenCalledTimes(1);
    expect(runMainMock).toHaveBeenCalledWith(rootCommand, {
      showUsage: expect.any(Function),
    });
  });

  it("calls checkForUpdates on module load", () => {
    expect(checkForUpdates).toHaveBeenCalled();
  });

  it("subcommand loaders return promises", () => {
    expect(loaderCalls.length).toBeGreaterThan(0);
    for (const { name, returned } of loaderCalls) {
      expect(returned, `the "${name}" loader did not return a promise`).toBeInstanceOf(Promise);
    }
  });
});
