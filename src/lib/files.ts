import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";

/**
 * Writes `data` to `path` readable only by the owner, via a temp file renamed into place so an
 * interrupted write never leaves a truncated file at `path`.
 */
export function writePrivateFile(path: string, data: string): void {
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  const fd = openSync(tmp, "wx", 0o600);
  try {
    try {
      writeFileSync(fd, data);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
  // The open mode is masked by the umask, so pin the final mode explicitly.
  if (process.platform !== "win32") chmodSync(path, 0o600);
}
