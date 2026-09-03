import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The CLI depends on the SDK as the published package `pgbeam`, and every one
 * of that package's exports points into `frontend/packages/sdk/dist`. Nothing
 * builds that dist before `pnpm test:frontend`, which is the documented way to
 * run unit tests, so on a clean checkout twelve CLI test files failed to
 * collect. Among them was `src/tree.test.ts`, the test that guards that every
 * generated command is registered, so the CLI's own contract test was reporting
 * a resolution error rather than a verdict. CI stayed green only because
 * `pnpm typecheck` runs first there and turbo's `^build` builds the SDK as a
 * side effect, which made the unit tests depend on the order of an unrelated
 * command.
 *
 * Resolving the two SDK entry points from source fixes that, and is the more
 * honest thing to test against: the CLI tests now run against the SDK as it is
 * in the tree instead of against whatever was last built into dist. Typecheck
 * and the compiled binary still go through the package exports, so the built
 * artifact keeps its own coverage.
 */
const sdkSource = (file: string) =>
  fileURLToPath(new URL(`../../packages/sdk/src/${file}`, import.meta.url));

/**
 * Order is load bearing. Vite matches a string alias as a prefix, so a bare
 * `pgbeam` entry placed first also swallows `pgbeam/operations` and rewrites it
 * to `.../src/index.ts/operations`, which resolves to nothing.
 * `src/sdk-alias.test.ts` pins the order for that reason.
 */
export const sdkAliases = [
  { find: "pgbeam/operations", replacement: sdkSource("operations.ts") },
  { find: "pgbeam", replacement: sdkSource("index.ts") },
];

export default defineConfig({
  resolve: { alias: sdkAliases },
  /**
   * Vitest would default to this. Knip would not: its vitest plugin reads the
   * test entry patterns off whatever config file it finds, so leaving `include`
   * out made a config file appear where there had been none and reported all 86
   * CLI test files as unused, which fails `pnpm knip`.
   */
  test: { include: ["**/*.test.ts"] },
});
