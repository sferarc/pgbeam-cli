import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("consola", () => ({
  consola: {
    info: vi.fn(),
    log: vi.fn(),
  },
}));

import { consola } from "consola";
import { formatDate, output, outputJson, outputTable } from "./output";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

// ---------------------------------------------------------------------------
// outputJson
// ---------------------------------------------------------------------------
describe("outputJson", () => {
  it("writes pretty-printed JSON to stdout", () => {
    const data = { id: "proj-1", name: "Test" };
    outputJson(data);

    expect(process.stdout.write).toHaveBeenCalledWith(`${JSON.stringify(data, null, 2)}\n`);
  });

  it("handles arrays", () => {
    const data = [1, 2, 3];
    outputJson(data);

    expect(process.stdout.write).toHaveBeenCalledWith(`${JSON.stringify(data, null, 2)}\n`);
  });

  it("handles null", () => {
    outputJson(null);

    expect(process.stdout.write).toHaveBeenCalledWith("null\n");
  });

  it("handles strings", () => {
    outputJson("hello");

    expect(process.stdout.write).toHaveBeenCalledWith('"hello"\n');
  });
});

// ---------------------------------------------------------------------------
// outputTable
// ---------------------------------------------------------------------------
describe("outputTable", () => {
  it("prints 'No results.' for empty rows", () => {
    outputTable([]);

    expect(consola.info).toHaveBeenCalledWith("No results.");
    expect(consola.log).not.toHaveBeenCalled();
  });

  it("prints a header and rows with auto-detected columns", () => {
    const rows = [
      { id: "1", name: "Alice" },
      { id: "2", name: "Bob" },
    ];

    outputTable(rows);

    // Header + 2 data rows = 3 log calls
    expect(consola.log).toHaveBeenCalledTimes(3);

    // Check header is uppercase
    const headerCall = vi.mocked(consola.log).mock.calls[0][0] as string;
    expect(headerCall).toContain("ID");
    expect(headerCall).toContain("NAME");
  });

  it("uses custom column labels when provided", () => {
    const rows = [{ id: "1", name: "Alice" }];
    const columns = [
      { key: "id", label: "Identifier" },
      { key: "name", label: "Full Name" },
    ];

    outputTable(rows, columns);

    const headerCall = vi.mocked(consola.log).mock.calls[0][0] as string;
    expect(headerCall).toContain("IDENTIFIER");
    expect(headerCall).toContain("FULL NAME");
  });

  it("pads columns to the width of the widest value", () => {
    const rows = [
      { id: "1", name: "Al" },
      { id: "2", name: "Elizabeth" },
    ];

    outputTable(rows);

    // The NAME column should be at least as wide as "Elizabeth" (9 chars)
    const row1 = vi.mocked(consola.log).mock.calls[1][0] as string;
    const row2 = vi.mocked(consola.log).mock.calls[2][0] as string;
    // Both rows should have the same total length due to padding
    expect(row1.length).toBe(row2.length);
  });

  it("handles null/undefined values in rows by rendering empty string", () => {
    const rows = [
      { id: "1", name: null },
      { id: "2", name: undefined },
    ];

    outputTable(rows as unknown as Record<string, unknown>[]);

    // Should not throw, null/undefined rendered as ""
    expect(consola.log).toHaveBeenCalledTimes(3);
  });

  it("selects only specified columns", () => {
    const rows = [{ id: "1", name: "Alice", secret: "hidden" }];
    const columns = [{ key: "id" }, { key: "name" }];

    outputTable(rows, columns);

    const headerCall = vi.mocked(consola.log).mock.calls[0][0] as string;
    expect(headerCall).toContain("ID");
    expect(headerCall).toContain("NAME");
    expect(headerCall).not.toContain("SECRET");
  });

  it("truncates wide cells with an ellipsis", () => {
    const long = "x".repeat(200);
    outputTable([{ sql: long }], [{ key: "sql", label: "SQL" }], { truncate: true });

    const row = vi.mocked(consola.log).mock.calls[1][0] as string;
    expect(row.trimEnd().length).toBe(60);
    expect(row.trimEnd().endsWith("…")).toBe(true);
  });

  it("renders full cells when truncation is disabled", () => {
    const long = "x".repeat(200);
    outputTable([{ sql: long }], [{ key: "sql", label: "SQL" }], { truncate: false });

    const row = vi.mocked(consola.log).mock.calls[1][0] as string;
    expect(row.trimEnd()).toBe(long);
  });

  it("collapses newlines inside cells", () => {
    outputTable([{ sql: "SELECT 1\n  FROM t" }], [{ key: "sql", label: "SQL" }], {
      truncate: true,
    });

    const row = vi.mocked(consola.log).mock.calls[1][0] as string;
    expect(row).toContain("SELECT 1 FROM t");
  });
});

// ---------------------------------------------------------------------------
// output
// ---------------------------------------------------------------------------
describe("output", () => {
  it("calls outputJson when json is true", () => {
    const data = { foo: "bar" };
    output(data, true);

    expect(process.stdout.write).toHaveBeenCalledWith(`${JSON.stringify(data, null, 2)}\n`);
  });

  it("calls tableFn when json is false and tableFn is provided", () => {
    const tableFn = vi.fn();
    output({ foo: "bar" }, false, tableFn);

    expect(tableFn).toHaveBeenCalledOnce();
    expect(process.stdout.write).not.toHaveBeenCalled();
  });

  it("renders records as key/value lines when json is false and no tableFn", () => {
    output({ foo: "bar", count: 2 }, false);

    expect(process.stdout.write).not.toHaveBeenCalled();
    const lines = vi.mocked(consola.log).mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => l.includes("foo:") && l.includes("bar"))).toBe(true);
    expect(lines.some((l) => l.includes("count:") && l.includes("2"))).toBe(true);
  });

  it("renders arrays of records as a table when json is false and no tableFn", () => {
    output([{ id: "1" }, { id: "2" }], false);

    expect(process.stdout.write).not.toHaveBeenCalled();
    const header = vi.mocked(consola.log).mock.calls[0][0] as string;
    expect(header).toContain("ID");
    expect(consola.log).toHaveBeenCalledTimes(3);
  });

  it("renders primitives as plain text when json is false and no tableFn", () => {
    output("hello", false);

    expect(consola.log).toHaveBeenCalledWith("hello");
  });
});

// ---------------------------------------------------------------------------
// formatDate
// ---------------------------------------------------------------------------
describe("formatDate", () => {
  const now = new Date("2026-07-24T12:00:00Z");

  it("renders an ISO date with a relative suffix", () => {
    expect(formatDate("2026-07-22T09:30:00Z", now)).toBe("2026-07-22 (2d ago)");
  });

  it("uses hour granularity within a day", () => {
    expect(formatDate("2026-07-24T09:00:00Z", now)).toBe("2026-07-24 (3h ago)");
  });

  it("uses minute granularity within an hour", () => {
    expect(formatDate("2026-07-24T11:45:00Z", now)).toBe("2026-07-24 (15m ago)");
  });

  it("renders very recent timestamps as just now", () => {
    expect(formatDate("2026-07-24T11:59:40Z", now)).toBe("2026-07-24 (just now)");
  });

  it("renders future dates with an 'in' prefix (e.g. expires_at)", () => {
    expect(formatDate("2026-08-13T12:00:00Z", now)).toBe("2026-08-13 (in 20d)");
  });

  it("uses month and year granularity for distant dates", () => {
    expect(formatDate("2026-02-01T00:00:00Z", now)).toBe("2026-02-01 (5mo ago)");
    expect(formatDate("2024-06-01T00:00:00Z", now)).toBe("2024-06-01 (2y ago)");
  });

  it("renders null, undefined, and empty values as a dash", () => {
    expect(formatDate(null, now)).toBe("-");
    expect(formatDate(undefined, now)).toBe("-");
    expect(formatDate("", now)).toBe("-");
  });

  it("passes unparseable values through unchanged", () => {
    expect(formatDate("not-a-date", now)).toBe("not-a-date");
  });
});
