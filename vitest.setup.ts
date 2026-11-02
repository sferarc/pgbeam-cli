import { vi } from "vitest";

// fsync takes seconds on a busy CI disk and timed tests out; durability is not what these tests check.
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  fsyncSync: vi.fn(),
}));
