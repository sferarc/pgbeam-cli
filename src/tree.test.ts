import { describe, expect, it } from "vitest";
import { commandManifest } from "./generated/manifest.gen.js";
import { subCommands } from "./tree.js";

interface ResolvedCommand {
  meta?: { name?: string };
  subCommands?: Record<string, unknown>;
}

async function resolve(entry: unknown): Promise<ResolvedCommand> {
  const value = typeof entry === "function" ? (entry as () => unknown)() : entry;
  const resolved = value instanceof Promise ? await value : value;
  return resolved as ResolvedCommand;
}

/** Walk the command tree along `path`, returning the resolved leaf or null. */
async function walk(path: string[]): Promise<ResolvedCommand | null> {
  let level: Record<string, unknown> = subCommands as Record<string, unknown>;
  let command: ResolvedCommand | null = null;
  for (const segment of path) {
    const entry = level[segment];
    if (!entry) return null;
    command = await resolve(entry);
    level = (command.subCommands ?? {}) as Record<string, unknown>;
  }
  return command;
}

/**
 * Every path this file asserts about, walked once here at module scope rather
 * than inside the tests.
 *
 * Walking the tree executes the CLI's whole lazy command graph: every command
 * module, the generated manifest, and the SDK. Under `pnpm test:frontend` that
 * load is Vite-transformed and v8-coverage-instrumented while 364 other test
 * files compete for the same cores, and it has been measured at 0.8s under
 * partial load against 0.1s in isolation, with the sibling walk in
 * `index.test.ts` reaching 1.7s. Doing it inside an `it()` therefore put
 * vitest's 5s per-test timeout around compiler throughput rather than around
 * the thing being asserted, and the test passed or failed with machine load.
 *
 * Module evaluation is covered by neither `testTimeout` nor `hookTimeout`, so
 * hoisting the walk to top-level await removes that clock instead of enlarging
 * it. What is left in each test is a map lookup, which is what these tests were
 * always about.
 */
const walked = new Map<string, ResolvedCommand | null>();

async function record(path: string[]): Promise<void> {
  walked.set(path.join(" "), await walk(path));
}

for (const spec of commandManifest) {
  await record(spec.command);
  for (const alias of spec.aliases) {
    await record([...spec.command.slice(0, -1), alias]);
  }
}
for (const group of ["domains", "replicas", "cache-rules", "env"]) {
  await record([group]);
}
for (const path of [
  ["link"],
  ["unlink"],
  ["projects", "link"],
  ["projects", "unlink"],
  ["whoami"],
]) {
  await record(path);
}

/** The leaf recorded above, or a hard failure if a test asks for an unwalked path. */
function leaf(path: string[]): ResolvedCommand | null {
  const key = path.join(" ");
  if (!walked.has(key)) {
    throw new Error(`"${key}" was not walked at module scope; add it to the list above`);
  }
  return walked.get(key) ?? null;
}

describe("command tree registration", () => {
  it("registers every generated command so none falls through to top-level help", () => {
    for (const spec of commandManifest) {
      const command = leaf(spec.command);
      expect(
        command,
        `command "${spec.command.join(" ")}" is not reachable from the tree`,
      ).not.toBeNull();
      const meta = command?.meta as { name?: string } | undefined;
      expect(meta?.name).toBe(spec.command[spec.command.length - 1]);
    }
  });

  it("resolves every generated alias to a command", () => {
    for (const spec of commandManifest) {
      for (const alias of spec.aliases) {
        const aliasPath = [...spec.command.slice(0, -1), alias];
        expect(leaf(aliasPath), `alias "${aliasPath.join(" ")}" is not reachable`).not.toBeNull();
      }
    }
  });

  it("exposes the project sub-resource groups at the top level too", () => {
    for (const group of ["domains", "replicas", "cache-rules", "env"]) {
      expect(leaf([group]), `top-level "${group}" is not registered`).not.toBeNull();
    }
  });

  it("registers top-level link and unlink aliases for projects link/unlink", () => {
    const link = leaf(["link"]);
    expect(link, 'top-level "link" is not registered').not.toBeNull();
    expect(link?.meta?.name).toBe("link");

    const unlink = leaf(["unlink"]);
    expect(unlink, 'top-level "unlink" is not registered').not.toBeNull();
    expect(unlink?.meta?.name).toBe("unlink");

    // The long forms stay available under projects.
    expect(leaf(["projects", "link"])).not.toBeNull();
    expect(leaf(["projects", "unlink"])).not.toBeNull();
  });

  it("registers whoami under its own name so --help shows 'whoami'", () => {
    const whoami = leaf(["whoami"]);
    expect(whoami).not.toBeNull();
    expect(whoami?.meta?.name).toBe("whoami");
  });
});
