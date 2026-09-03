import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PgBeamClient } from "pgbeam";
import { operationsByTag } from "pgbeam/operations";
import { describe, expect, test } from "vitest";
import { sdkAliases } from "./vitest.config.js";

/**
 * The CLI imports the SDK as the published package, whose every export points
 * into `frontend/packages/sdk/dist`. Nothing builds that dist before
 * `pnpm test:frontend`, so on a clean checkout these imports failed to resolve
 * and took twelve CLI test files down with them. `vitest.config.ts` aliases the
 * two SDK entry points to their sources; this file is what notices if that
 * aliasing stops working.
 *
 * It sits beside that config rather than under `src/` on purpose: `tsconfig.json`
 * sets `rootDir` to `src`, so a test that lives there and imports the config
 * fails `tsc --noEmit` with TS6059 before it ever runs.
 */
describe("the SDK resolves from source in the CLI's test run", () => {
  test("both entry points import without the SDK having been built", () => {
    expect(typeof PgBeamClient).toBe("function");
    expect(Object.keys(operationsByTag).length).toBeGreaterThan(0);
  });

  test("every alias points at a file that exists under the SDK's src", () => {
    const sdkSrc = fileURLToPath(new URL("../../packages/sdk/src/", import.meta.url));

    expect(sdkAliases.map((alias) => alias.find)).toEqual(["pgbeam/operations", "pgbeam"]);
    for (const alias of sdkAliases) {
      expect(alias.replacement.startsWith(sdkSrc)).toBe(true);
      expect(existsSync(alias.replacement)).toBe(true);
    }
  });

  /**
   * Vite matches a string alias as a prefix, so a bare `pgbeam` entry ahead of
   * `pgbeam/operations` swallows the subpath and rewrites it to
   * `.../src/index.ts/operations`, which resolves to nothing. The order in the
   * config is load bearing, and the assertion above pins it, so this states why.
   */
  test("the subpath alias is ordered ahead of the bare one", () => {
    const bare = sdkAliases.findIndex((alias) => alias.find === "pgbeam");
    const subpath = sdkAliases.findIndex((alias) => alias.find === "pgbeam/operations");

    expect(subpath).toBeLessThan(bare);
  });
});
