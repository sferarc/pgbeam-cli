import { describe, expect, it } from "vitest";
import {
  insightRanges,
  optionalArg,
  parseEnum,
  parseExpiry,
  parseNumber,
  poolModes,
  requireArg,
  sslModes,
  typedEntries,
} from "./args.js";

describe("requireArg", () => {
  it("returns the string when given a valid non-empty string", () => {
    expect(requireArg("hello", "test")).toBe("hello");
  });

  it("returns the string for whitespace-only input (not trimmed)", () => {
    expect(requireArg("  ", "test")).toBe("  ");
  });

  it("throws when given an empty string", () => {
    expect(() => requireArg("", "myFlag")).toThrow("Missing required argument: myFlag");
  });

  it("throws when given a boolean true", () => {
    expect(() => requireArg(true, "myFlag")).toThrow("Missing required argument: myFlag");
  });

  it("throws when given a boolean false", () => {
    expect(() => requireArg(false, "myFlag")).toThrow("Missing required argument: myFlag");
  });

  it("throws when given undefined", () => {
    expect(() => requireArg(undefined, "myFlag")).toThrow("Missing required argument: myFlag");
  });

  it("includes the argument name in the error message", () => {
    expect(() => requireArg(undefined, "project-id")).toThrow("project-id");
  });
});

describe("optionalArg", () => {
  it("returns the string when given a string value", () => {
    expect(optionalArg("hello")).toBe("hello");
  });

  it("returns an empty string when given an empty string", () => {
    expect(optionalArg("")).toBe("");
  });

  it("returns undefined when given boolean true", () => {
    expect(optionalArg(true)).toBeUndefined();
  });

  it("returns undefined when given boolean false", () => {
    expect(optionalArg(false)).toBeUndefined();
  });

  it("returns undefined when given undefined", () => {
    expect(optionalArg(undefined)).toBeUndefined();
  });
});

describe("typedEntries", () => {
  it("returns entries for a simple object", () => {
    const obj = { a: 1, b: 2, c: 3 } as const;
    const entries = typedEntries(obj);
    expect(entries).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
  });

  it("returns an empty array for an empty object", () => {
    const entries = typedEntries({});
    expect(entries).toEqual([]);
  });

  it("preserves string values", () => {
    const obj = { key1: "val1", key2: "val2" };
    const entries = typedEntries(obj);
    expect(entries).toEqual([
      ["key1", "val1"],
      ["key2", "val2"],
    ]);
  });
});

describe("parseEnum", () => {
  const testEnum = { foo: "foo", bar: "bar", baz: "baz" } as const;

  it("returns the value for a valid enum key", () => {
    expect(parseEnum("foo", testEnum, "mode")).toBe("foo");
    expect(parseEnum("bar", testEnum, "mode")).toBe("bar");
    expect(parseEnum("baz", testEnum, "mode")).toBe("baz");
  });

  it("throws for an invalid enum key", () => {
    expect(() => parseEnum("invalid", testEnum, "mode")).toThrow(
      'Invalid mode: "invalid". Allowed: foo, bar, baz',
    );
  });

  it("throws with the correct argument name in the error message", () => {
    expect(() => parseEnum("nope", testEnum, "ssl-mode")).toThrow("Invalid ssl-mode");
  });

  it("lists all allowed values in the error message", () => {
    expect(() => parseEnum("x", testEnum, "test")).toThrow("Allowed: foo, bar, baz");
  });

  it("works with sslModes", () => {
    expect(parseEnum("require", sslModes, "ssl")).toBe("require");
    expect(parseEnum("verify-full", sslModes, "ssl")).toBe("verify-full");
  });

  it("works with poolModes", () => {
    expect(parseEnum("transaction", poolModes, "pool")).toBe("transaction");
  });

  it("works with insightRanges", () => {
    expect(parseEnum("7d", insightRanges, "range")).toBe("7d");
  });
});

describe("parseNumber", () => {
  it("parses an integer string", () => {
    expect(parseNumber("42", "port")).toBe(42);
  });

  it("parses a floating point string", () => {
    expect(parseNumber("3.14", "ratio")).toBe(3.14);
  });

  it("parses zero", () => {
    expect(parseNumber("0", "count")).toBe(0);
  });

  it("parses negative numbers", () => {
    expect(parseNumber("-5", "offset")).toBe(-5);
  });

  it("throws for non-numeric strings", () => {
    expect(() => parseNumber("abc", "port")).toThrow('Invalid port: "abc" is not a number.');
  });

  it("returns 0 for an empty string (Number('') === 0)", () => {
    // Note: Number("") evaluates to 0, not NaN, so parseNumber does not throw.
    expect(parseNumber("", "port")).toBe(0);
  });

  it("includes the argument name in the error message", () => {
    expect(() => parseNumber("xyz", "pool-size")).toThrow("Invalid pool-size");
  });

  it("includes the invalid value in the error message", () => {
    expect(() => parseNumber("notanumber", "port")).toThrow('"notanumber"');
  });
});

describe("parseExpiry", () => {
  // Fixed reference point so duration math is deterministic.
  const now = new Date("2026-01-01T00:00:00.000Z");

  it("parses a seconds duration", () => {
    expect(parseExpiry("3600s", now)).toBe("2026-01-01T01:00:00.000Z");
  });

  it("parses a minutes duration", () => {
    expect(parseExpiry("90m", now)).toBe("2026-01-01T01:30:00.000Z");
  });

  it("parses an hours duration", () => {
    expect(parseExpiry("12h", now)).toBe("2026-01-01T12:00:00.000Z");
  });

  it("parses a days duration", () => {
    expect(parseExpiry("30d", now)).toBe("2026-01-31T00:00:00.000Z");
  });

  it("parses a weeks duration", () => {
    expect(parseExpiry("2w", now)).toBe("2026-01-15T00:00:00.000Z");
  });

  it("passes through an absolute future ISO 8601 timestamp, normalized", () => {
    expect(parseExpiry("2026-12-31T23:59:00Z", now)).toBe("2026-12-31T23:59:00.000Z");
  });

  it("normalizes a future timestamp with a numeric offset to UTC", () => {
    expect(parseExpiry("2026-12-31T23:59:00+02:00", now)).toBe("2026-12-31T21:59:00.000Z");
  });

  it("defaults to the current time when no reference is given", () => {
    const before = Date.now();
    const result = new Date(parseExpiry("1h")).getTime();
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before + 3_600_000);
    expect(result).toBeLessThanOrEqual(after + 3_600_000);
  });

  it("throws for an absolute timestamp in the past", () => {
    expect(() => parseExpiry("2020-01-01T00:00:00Z", now)).toThrow(
      'Invalid --expires: "2020-01-01T00:00:00Z" must be in the future.',
    );
  });

  it("throws for a timestamp equal to now (not strictly future)", () => {
    expect(() => parseExpiry("2026-01-01T00:00:00Z", now)).toThrow("must be in the future");
  });

  it("throws for a zero duration", () => {
    expect(() => parseExpiry("0d", now)).toThrow("must be a positive duration");
  });

  it("throws for a negative duration", () => {
    expect(() => parseExpiry("-5d", now)).toThrow("must be a positive duration");
  });

  it("throws for an unknown unit", () => {
    expect(() => parseExpiry("10y", now)).toThrow('unknown unit "y"');
  });

  it("throws for garbage input", () => {
    expect(() => parseExpiry("not-a-date", now)).toThrow("Invalid --expires");
  });

  it("throws for an empty string", () => {
    expect(() => parseExpiry("", now)).toThrow("Invalid --expires");
  });

  it("throws for a whitespace-only string", () => {
    expect(() => parseExpiry("   ", now)).toThrow("Invalid --expires");
  });

  it("trims surrounding whitespace before parsing a duration", () => {
    expect(parseExpiry("  12h  ", now)).toBe("2026-01-01T12:00:00.000Z");
  });

  it("includes the offending value in the error message", () => {
    expect(() => parseExpiry("bogus", now)).toThrow('"bogus"');
  });
});

describe("constants", () => {
  describe("sslModes", () => {
    it("has exactly 6 entries", () => {
      expect(Object.keys(sslModes)).toHaveLength(6);
    });

    it("contains all expected SSL modes", () => {
      expect(Object.keys(sslModes)).toEqual(
        expect.arrayContaining([
          "disable",
          "allow",
          "prefer",
          "require",
          "verify-ca",
          "verify-full",
        ]),
      );
    });

    it("has matching keys and values", () => {
      for (const [key, value] of typedEntries(sslModes)) {
        expect(key).toBe(value);
      }
    });
  });

  describe("poolModes", () => {
    it("has exactly 3 entries", () => {
      expect(Object.keys(poolModes)).toHaveLength(3);
    });

    it("contains all expected pool modes", () => {
      expect(Object.keys(poolModes)).toEqual(
        expect.arrayContaining(["session", "transaction", "statement"]),
      );
    });

    it("has matching keys and values", () => {
      for (const [key, value] of typedEntries(poolModes)) {
        expect(key).toBe(value);
      }
    });
  });

  describe("insightRanges", () => {
    it("has exactly 4 entries", () => {
      expect(Object.keys(insightRanges)).toHaveLength(4);
    });

    it("contains all expected ranges", () => {
      expect(Object.keys(insightRanges)).toEqual(expect.arrayContaining(["1h", "6h", "24h", "7d"]));
    });

    it("has matching keys and values", () => {
      for (const [key, value] of typedEntries(insightRanges)) {
        expect(key).toBe(value);
      }
    });
  });
});
