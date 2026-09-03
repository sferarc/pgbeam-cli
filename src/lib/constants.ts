import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

declare const __PGBEAM_VERSION__: string;

/**
 * Read the version out of the package manifest, for the builds that do not
 * inject `__PGBEAM_VERSION__`.
 *
 * Two levels up is the package root in both layouts this code ships in: from
 * `src/lib/` when bun runs the sources, and from `dist/bin/` in the npm package,
 * where bunchee bundles this module into `dist/bin/pgbeam.js` and its chunks.
 * `package.json` is in the published tarball regardless of the `files` list, so
 * the read resolves inside an installed package too.
 */
function readVersionFromPackageJson(): string {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    return JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf-8")).version;
  } catch {
    return "0.0.0-unknown";
  }
}

/**
 * Strip a single pair of wrapping quotes from a version string. Guards against a
 * build-time define that injects the version as a JSON-quoted string (e.g.
 * `'"0.2.0"'`), which would otherwise surface as `v"0.2.0"` in the CLI output.
 */
export function normalizeVersion(version: string): string {
  return version.replace(/^(["'])(.*)\1$/, "$2");
}

export const VERSION: string = normalizeVersion(
  typeof __PGBEAM_VERSION__ !== "undefined" ? __PGBEAM_VERSION__ : readVersionFromPackageJson(),
);
