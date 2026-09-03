import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  assertValidPolicyInput,
  collectRepeatable,
  hasRepeatable,
  parseMaskFlag,
  readDraftPolicyFile,
  readPolicyFile,
  validatePolicyInput,
} from "./policy";

const tmp = mkdtempSync(join(tmpdir(), "pgbeam-policy-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("collectRepeatable", () => {
  it("collects repeated flag occurrences from rawArgs", () => {
    const raw = ["--allow", "public.users", "--allow", "public.orders"];
    expect(collectRepeatable("allow", raw, "public.orders")).toEqual([
      "public.users",
      "public.orders",
    ]);
  });

  it("collects --flag=value occurrences from rawArgs", () => {
    const raw = ["--allow=a", "--allow=b"];
    expect(collectRepeatable("allow", raw, "b")).toEqual(["a", "b"]);
  });

  it("splits comma-separated values", () => {
    expect(collectRepeatable("allow", undefined, "a, b,c")).toEqual(["a", "b", "c"]);
  });

  it("falls back to the parsed value when rawArgs is missing", () => {
    expect(collectRepeatable("allow", undefined, "public.users")).toEqual(["public.users"]);
  });

  it("accepts an array fallback", () => {
    expect(collectRepeatable("allow", undefined, ["a", "b"])).toEqual(["a", "b"]);
  });

  it("returns an empty list when the flag is absent", () => {
    expect(collectRepeatable("allow", ["--deny", "x"], undefined)).toEqual([]);
  });
});

describe("hasRepeatable", () => {
  it("detects the flag in rawArgs", () => {
    expect(hasRepeatable("allow", ["--allow", "x"], undefined)).toBe(true);
    expect(hasRepeatable("allow", ["--allow=x"], undefined)).toBe(true);
  });

  it("detects the parsed fallback", () => {
    expect(hasRepeatable("allow", undefined, "x")).toBe(true);
  });

  it("returns false when absent", () => {
    expect(hasRepeatable("allow", ["--deny", "x"], undefined)).toBe(false);
  });
});

describe("parseMaskFlag", () => {
  it("parses table.column=kind", () => {
    expect(parseMaskFlag("users.email=redact")).toEqual({
      table: "users",
      column: "email",
      kind: "redact",
    });
  });

  it("keeps a schema-qualified table intact", () => {
    expect(parseMaskFlag("public.users.email=hash")).toEqual({
      table: "public.users",
      column: "email",
      kind: "hash",
    });
  });

  it("rejects an unknown masking kind with the allowed kinds listed", () => {
    expect(() => parseMaskFlag("users.email=scramble")).toThrow(
      /Invalid --mask kind "scramble".*redact, null, hash/,
    );
  });

  it("rejects a value without =kind", () => {
    expect(() => parseMaskFlag("users.email")).toThrow(/expected table\.column=kind/);
  });

  it("rejects a value without a column", () => {
    expect(() => parseMaskFlag("users=redact")).toThrow(/expected table\.column=kind/);
  });
});

describe("validatePolicyInput", () => {
  it("accepts a full valid profile", () => {
    expect(
      validatePolicyInput({
        name: "read-only",
        access_mode: "read_only",
        table_allowlist: ["public.users"],
        table_denylist: [],
        masking_rules: [{ table: "users", column: "email", kind: "redact" }],
        budget_queries_per_day: 5000,
        max_rows: 100,
        statement_timeout_ms: 0,
        statement_rules: { allow: ["select"], deny: [] },
        row_filters: [{ table: "orders", predicate: "tenant_id = 1" }],
      }),
    ).toEqual([]);
  });

  it("requires name", () => {
    expect(validatePolicyInput({})).toEqual([
      expect.stringContaining("policy.name: required field is missing"),
    ]);
  });

  it("flags unknown fields", () => {
    const problems = validatePolicyInput({ name: "x", allowlist: ["users"] });
    expect(problems).toEqual([expect.stringContaining("policy.allowlist: unknown field")]);
  });

  it("flags a bad enum value", () => {
    const problems = validatePolicyInput({ name: "x", access_mode: "readonly" });
    expect(problems).toEqual([
      expect.stringContaining('policy.access_mode: "readonly" is not one of read_only, read_write'),
    ]);
  });

  it("flags a wrong scalar type", () => {
    const problems = validatePolicyInput({ name: "x", max_rows: "100" });
    expect(problems).toEqual([expect.stringContaining("policy.max_rows: expected a number")]);
  });

  it("flags a negative budget", () => {
    const problems = validatePolicyInput({ name: "x", budget_queries_per_day: -1 });
    expect(problems).toEqual([
      expect.stringContaining("policy.budget_queries_per_day: must be at least 0"),
    ]);
  });

  it("validates nested masking rules", () => {
    const problems = validatePolicyInput({
      name: "x",
      masking_rules: [{ table: "users", kind: "redact" }],
    });
    expect(problems).toEqual([
      expect.stringContaining("policy.masking_rules[0].column: required field is missing"),
    ]);
  });

  it("collects multiple problems at once", () => {
    const problems = validatePolicyInput({ access_mode: "nope", bogus: true });
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });
});

describe("assertValidPolicyInput", () => {
  it("throws a readable error listing each problem", () => {
    expect(() => assertValidPolicyInput({ access_mode: "nope" }, "--file p.json")).toThrow(
      /Invalid policy profile \(--file p\.json\):[\s\S]*name: required field/,
    );
  });

  it("does not throw for a valid body", () => {
    expect(() => assertValidPolicyInput({ name: "ok" }, "resolved profile")).not.toThrow();
  });
});

describe("readPolicyFile", () => {
  it("reads a JSON object", () => {
    const path = join(tmp, "ok.json");
    writeFileSync(path, JSON.stringify({ name: "x" }));
    expect(readPolicyFile(path)).toEqual({ name: "x" });
  });

  it("fails clearly on invalid JSON", () => {
    const path = join(tmp, "bad.json");
    writeFileSync(path, "{ not json");
    expect(() => readPolicyFile(path)).toThrow(/is not valid JSON/);
  });

  it("fails clearly on a non-object", () => {
    const path = join(tmp, "array.json");
    writeFileSync(path, "[1, 2]");
    expect(() => readPolicyFile(path)).toThrow(/must contain a JSON object/);
  });

  it("fails clearly on a missing file", () => {
    expect(() => readPolicyFile(join(tmp, "missing.json"))).toThrow(/Could not read --file/);
  });

  it("names the flag it was reading for", () => {
    expect(() => readPolicyFile(join(tmp, "missing.json"), "--draft")).toThrow(
      /Could not read --draft/,
    );
  });
});

describe("readDraftPolicyFile", () => {
  it("reads and validates a draft policy body", () => {
    const path = join(tmp, "draft.json");
    writeFileSync(path, JSON.stringify({ name: "draft-policy", access_mode: "read_only" }));
    expect(readDraftPolicyFile(path)).toEqual({ name: "draft-policy", access_mode: "read_only" });
  });

  it("tolerates a missing name (the API supplies a placeholder for drafts)", () => {
    const path = join(tmp, "draft-nameless.json");
    writeFileSync(path, JSON.stringify({ access_mode: "read_only" }));
    expect(readDraftPolicyFile(path)).toEqual({ access_mode: "read_only" });
  });

  it("fails clearly on a missing file, mentioning --draft", () => {
    expect(() => readDraftPolicyFile(join(tmp, "missing-draft.json"))).toThrow(
      /Could not read --draft/,
    );
  });

  it("fails clearly on invalid JSON", () => {
    const path = join(tmp, "draft-bad.json");
    writeFileSync(path, "{ not json");
    expect(() => readDraftPolicyFile(path)).toThrow(/is not valid JSON/);
  });

  it("fails schema validation for unknown fields", () => {
    const path = join(tmp, "draft-unknown.json");
    writeFileSync(path, JSON.stringify({ acces_mode: "read_only" }));
    expect(() => readDraftPolicyFile(path)).toThrow(/unknown field/);
  });
});
