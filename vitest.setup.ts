import { vi } from "vitest";

// fsync takes seconds on a busy CI disk and timed tests out; durability is not what these tests check.
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  fsyncSync: vi.fn(),
}));

// Rename, chmod and rm still stalled past 10s on the shared runner disk, so keep test temp dirs on tmpfs.
vi.mock("node:os", async (importOriginal) => {
  const os = await importOriginal<typeof import("node:os")>();
  const { accessSync, constants } = await vi.importActual<typeof import("node:fs")>("node:fs");
  const shmWritable = (): boolean => {
    try {
      accessSync("/dev/shm", constants.W_OK);
      return true;
    } catch {
      return false;
    }
  };
  const dir = os.platform() === "linux" && shmWritable() ? "/dev/shm" : os.tmpdir();
  const tmpdir = () => dir;
  return { ...os, tmpdir, default: { ...os, tmpdir } };
});
