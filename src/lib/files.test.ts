import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writePrivateFile } from "./files.js";

describe("writePrivateFile", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pgbeam-files-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("replaces the target and leaves no temp file behind", () => {
    const out = join(dir, "out.txt");
    writePrivateFile(out, "first");
    writePrivateFile(out, "second");

    expect(readFileSync(out, "utf-8")).toBe("second");
    expect(readdirSync(dir)).toEqual(["out.txt"]);
    if (process.platform !== "win32") expect(statSync(out).mode & 0o777).toBe(0o600);
  });

  it("removes the temp file when the rename fails", () => {
    const out = join(dir, "out.txt");
    mkdirSync(out);

    expect(() => writePrivateFile(out, "data")).toThrow();
    expect(readdirSync(dir)).toEqual(["out.txt"]);
    expect(statSync(out).isDirectory()).toBe(true);
  });
});
