import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { readStdin } from "./stdin.js";

describe("readStdin", () => {
  it("concatenates byte chunks, including a multi-byte character split across them", async () => {
    const bytes = new TextEncoder().encode("sécret\n");
    const stream = Readable.from([bytes.slice(0, 2), bytes.slice(2)]);

    expect(await readStdin(stream)).toBe("sécret\n");
  });

  it("accepts string chunks", async () => {
    expect(await readStdin(Readable.from(["a", "b"], { objectMode: true }))).toBe("ab");
  });

  it("returns an empty string for empty input", async () => {
    expect(await readStdin(Readable.from([]))).toBe("");
  });
});
