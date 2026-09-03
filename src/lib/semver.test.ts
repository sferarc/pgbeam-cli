import { describe, expect, it } from "vitest";
import { isNewer, parseSemver } from "./semver.js";

describe("parseSemver", () => {
  it("parses a plain version", () => {
    expect(parseSemver("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it("ignores a leading v", () => {
    expect(parseSemver("v0.10.4")).toEqual({ major: 0, minor: 10, patch: 4 });
  });

  it("parses the numeric prefix of a pre-release", () => {
    expect(parseSemver("2.0.0-rc.1")).toEqual({ major: 2, minor: 0, patch: 0 });
  });

  it("returns null for unparseable input", () => {
    expect(parseSemver("pr-434")).toBeNull();
    expect(parseSemver("")).toBeNull();
  });
});

describe("isNewer", () => {
  it("compares major, minor, then patch", () => {
    expect(isNewer("1.0.0", "2.0.0")).toBe(true);
    expect(isNewer("1.2.0", "1.3.0")).toBe(true);
    expect(isNewer("1.2.3", "1.2.4")).toBe(true);
  });

  it("is false for equal or older versions", () => {
    expect(isNewer("1.2.3", "1.2.3")).toBe(false);
    expect(isNewer("2.0.0", "1.9.9")).toBe(false);
  });

  it("is false when either side is unparseable", () => {
    expect(isNewer("1.0.0", "not-a-version")).toBe(false);
    expect(isNewer("garbage", "1.0.0")).toBe(false);
  });
});
