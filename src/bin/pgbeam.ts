#!/usr/bin/env node
/**
 * The executable entry point, for every artifact: the npm package's `bin`, the
 * `bun build --compile` binaries, and `pnpm dev`.
 *
 * It is a two-line shim rather than `src/index.ts` itself because bunchee
 * resolves a `bin` entry by convention: `"bin": { "pgbeam": "./dist/bin/pgbeam.js" }`
 * is built from `src/bin/pgbeam.ts` and from nowhere else. Renaming
 * `src/index.ts` into this slot would have been the alternative, and it would
 * have moved every relative import in the tree and broken `src/index.test.ts`,
 * which imports the entry module by path.
 *
 * The shebang lives here and nowhere else. Node is the interpreter because the
 * npm package has to run on a machine with no bun on it; the compiled binaries
 * embed their own runtime and ignore the line entirely.
 */
import "../index.js";
