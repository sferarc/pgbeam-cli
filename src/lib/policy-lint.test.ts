import { describe, expect, it } from "vitest";
import {
  type LintablePolicy,
  lintPolicy,
  summarizeFindings,
  worstSeverity,
} from "./policy-lint.js";

/** Find a finding by code, or fail readably. */
function byCode(policy: LintablePolicy, code: string) {
  return lintPolicy(policy).find((f) => f.code === code);
}

function codes(policy: LintablePolicy): string[] {
  return lintPolicy(policy).map((f) => f.code);
}

describe("lintPolicy", () => {
  it("flags read-write with no allowlist as a warning", () => {
    const finding = byCode({ access_mode: "read_write" }, "write-no-allowlist");
    expect(finding?.severity).toBe("warning");
  });

  it("does not flag write-no-allowlist when an allowlist is present", () => {
    expect(codes({ access_mode: "read_write", table_allowlist: ["users"] })).not.toContain(
      "write-no-allowlist",
    );
  });

  it("does not flag write-no-allowlist for a read-only policy", () => {
    expect(codes({ access_mode: "read_only" })).not.toContain("write-no-allowlist");
  });

  it("treats unset access_mode as read_only", () => {
    // No access_mode means read_only, so the write rules must not fire.
    const result = codes({ table_allowlist: ["users"] });
    expect(result).not.toContain("write-no-allowlist");
    expect(result).not.toContain("unbounded-writes");
  });

  it("flags unbounded writes when commit is direct with no cap or approval", () => {
    const finding = byCode(
      { access_mode: "read_write", table_allowlist: ["users"] },
      "unbounded-writes",
    );
    expect(finding?.severity).toBe("warning");
  });

  it("does not flag unbounded writes when max_affected_rows caps them", () => {
    expect(
      codes({ access_mode: "read_write", table_allowlist: ["users"], max_affected_rows: 100 }),
    ).not.toContain("unbounded-writes");
  });

  it("does not flag unbounded writes under rollback write_mode", () => {
    expect(
      codes({ access_mode: "read_write", table_allowlist: ["users"], write_mode: "rollback" }),
    ).not.toContain("unbounded-writes");
  });

  it("does not flag unbounded writes when approvals are on", () => {
    expect(
      codes({ access_mode: "read_write", table_allowlist: ["users"], approval_mode: "writes" }),
    ).not.toContain("unbounded-writes");
  });

  it("flags a missing query budget", () => {
    expect(byCode({ max_rows: 100 }, "no-query-budget")?.severity).toBe("warning");
  });

  it("treats a zero budget as unlimited (still flagged)", () => {
    // 0 means unlimited in the data plane, so a zero budget is no budget.
    expect(codes({ budget_queries_per_hour: 0, budget_queries_per_day: 0 })).toContain(
      "no-query-budget",
    );
  });

  it("does not flag a query budget when one is set", () => {
    expect(codes({ budget_queries_per_hour: 500 })).not.toContain("no-query-budget");
  });

  it("flags no read ceiling as info without masking", () => {
    expect(byCode({ budget_queries_per_day: 1 }, "no-read-ceiling")?.severity).toBe("info");
  });

  it("escalates no read ceiling to a warning when masking PII", () => {
    const finding = byCode(
      {
        budget_queries_per_day: 1,
        masking_rules: [{ table: "users", column: "email", kind: "redact" }],
      },
      "no-read-ceiling",
    );
    expect(finding?.severity).toBe("warning");
  });

  it("does not flag a read ceiling when max_rows is set", () => {
    expect(codes({ budget_queries_per_day: 1, max_rows: 1000 })).not.toContain("no-read-ceiling");
  });

  it("does not flag a read ceiling when egress_bytes_per_day is set", () => {
    expect(codes({ budget_queries_per_day: 1, egress_bytes_per_day: 1_000_000 })).not.toContain(
      "no-read-ceiling",
    );
  });

  it("flags a masking rule on a table excluded by the allowlist", () => {
    const finding = byCode(
      {
        max_rows: 10,
        budget_queries_per_day: 1,
        table_allowlist: ["orders"],
        masking_rules: [{ table: "secrets", column: "token", kind: "null" }],
      },
      "dead-mask-rule",
    );
    expect(finding?.severity).toBe("info");
    expect(finding?.message).toContain("secrets");
  });

  it("flags a masking rule on a denylisted table", () => {
    expect(
      codes({
        max_rows: 10,
        budget_queries_per_day: 1,
        table_denylist: ["secrets"],
        masking_rules: [{ table: "secrets", column: "token", kind: "null" }],
      }),
    ).toContain("dead-mask-rule");
  });

  it("does not flag a masking rule on a reachable table (schema-lenient match)", () => {
    // public.users in the allowlist matches a bare "users" masking target.
    expect(
      codes({
        max_rows: 10,
        budget_queries_per_day: 1,
        table_allowlist: ["public.users"],
        masking_rules: [{ table: "users", column: "email", kind: "redact" }],
      }),
    ).not.toContain("dead-mask-rule");
  });

  it("deduplicates dead-mask findings by table", () => {
    const findings = lintPolicy({
      max_rows: 10,
      budget_queries_per_day: 1,
      table_allowlist: ["orders"],
      masking_rules: [
        { table: "secrets", column: "a", kind: "null" },
        { table: "secrets", column: "b", kind: "hash" },
      ],
    }).filter((f) => f.code === "dead-mask-rule");
    expect(findings).toHaveLength(1);
  });

  it("flags a row filter on an unreachable table", () => {
    expect(
      codes({
        max_rows: 10,
        budget_queries_per_day: 1,
        table_allowlist: ["orders"],
        row_filters: [{ table: "audit", predicate: "tenant_id = 1" }],
      }),
    ).toContain("dead-row-filter");
  });

  it("flags inert write settings on a read-only policy", () => {
    const finding = byCode(
      {
        access_mode: "read_only",
        max_rows: 10,
        budget_queries_per_day: 1,
        write_mode: "sandbox",
        approval_mode: "all",
        max_affected_rows: 5,
      },
      "write-settings-on-readonly",
    );
    expect(finding?.severity).toBe("info");
    expect(finding?.message).toContain("write_mode=sandbox");
    expect(finding?.message).toContain("approval_mode=all");
    expect(finding?.message).toContain("max_affected_rows");
  });

  it("does not flag inert write settings on a read-write policy", () => {
    expect(
      codes({
        access_mode: "read_write",
        table_allowlist: ["users"],
        max_affected_rows: 5,
        max_rows: 10,
        budget_queries_per_day: 1,
      }),
    ).not.toContain("write-settings-on-readonly");
  });

  it("flags allowlist and denylist used together", () => {
    expect(
      codes({
        max_rows: 10,
        budget_queries_per_day: 1,
        table_allowlist: ["users"],
        table_denylist: ["secrets"],
      }),
    ).toContain("allowlist-and-denylist");
  });

  it("flags overlapping statement allow and deny", () => {
    expect(
      codes({
        max_rows: 10,
        budget_queries_per_day: 1,
        statement_rules: { allow: ["select"], deny: ["delete"] },
      }),
    ).toContain("allow-and-deny");
  });

  it("returns no findings for a tightly scoped read-only policy", () => {
    const findings = lintPolicy({
      access_mode: "read_only",
      table_allowlist: ["public.users"],
      max_rows: 500,
      budget_queries_per_hour: 200,
      masking_rules: [{ table: "public.users", column: "email", kind: "redact" }],
    });
    expect(findings).toEqual([]);
  });

  it("sorts findings worst severity first", () => {
    const findings = lintPolicy({ access_mode: "read_write" });
    const ranks = findings.map((f) => f.severity);
    // Warnings must precede infos.
    const firstInfo = ranks.indexOf("info");
    const lastWarning = ranks.lastIndexOf("warning");
    if (firstInfo !== -1 && lastWarning !== -1) {
      expect(lastWarning).toBeLessThan(firstInfo);
    }
  });
});

describe("summarizeFindings", () => {
  it("counts by severity", () => {
    const findings = lintPolicy({ access_mode: "read_write" });
    const summary = summarizeFindings(findings);
    expect(summary.warning).toBeGreaterThan(0);
    expect(summary.error).toBe(0);
    expect(summary.warning + summary.info + summary.error).toBe(findings.length);
  });

  it("returns zeros for no findings", () => {
    expect(summarizeFindings([])).toEqual({ error: 0, warning: 0, info: 0 });
  });
});

describe("worstSeverity", () => {
  it("returns null for no findings", () => {
    expect(worstSeverity([])).toBeNull();
  });

  it("returns warning when warnings are present", () => {
    expect(worstSeverity(lintPolicy({ access_mode: "read_write" }))).toBe("warning");
  });

  it("returns info when only info findings are present", () => {
    // A read-only policy with a budget and a read cap but redundant lists yields info only.
    const findings = lintPolicy({
      access_mode: "read_only",
      max_rows: 10,
      budget_queries_per_day: 1,
      table_allowlist: ["users"],
      table_denylist: ["secrets"],
    });
    expect(worstSeverity(findings)).toBe("info");
  });
});
