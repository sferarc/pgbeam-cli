/**
 * Static policy linter: pure, offline heuristics that flag risky combinations
 * in an agent policy profile before it is attached to a credential. This never
 * talks to the API and never evaluates SQL; it reasons only about the policy's
 * own shape. It complements `policies dry-eval` (what a single statement would
 * do) and `policies replay` (what recorded traffic would do) by catching
 * configuration risks that no single query reveals, e.g. a read-write policy
 * with no table allowlist, or PII masking with no read ceiling.
 *
 * Enforcement semantics the rules rely on (verified against the data plane):
 *  - access_mode defaults to read_only when unset (handlers/policies.go).
 *  - budgets, max_rows, egress_bytes_per_day, max_affected_rows all gate on
 *    `> 0`, so 0 or unset means unlimited (policyeval.go, agent_enforce.go).
 *  - write_mode defaults to "normal" (direct commit); approval_mode to "off".
 *  - table_denylist takes precedence over table_allowlist, and an allowlist,
 *    when non-empty, blocks every relation not listed (policy.go).
 *  - statement-kind deny takes precedence over allow (policy.go).
 */

export type LintSeverity = "error" | "warning" | "info";

/** Rank used to sort findings and to pick the worst severity. Lower is worse. */
const severityRank: Record<LintSeverity, number> = { error: 0, warning: 1, info: 2 };

export interface LintFinding {
  /** Stable machine-readable rule id, e.g. "write-no-allowlist". */
  code: string;
  severity: LintSeverity;
  /** What is risky, in plain language. */
  message: string;
  /** A concrete fix. */
  suggestion: string;
}

/**
 * The subset of policy fields the linter reads. Both the SDK `PolicyProfile`
 * (read shape) and `PolicyProfileInput` (draft/create shape) structurally
 * satisfy this, so a saved policy and an unsaved draft lint through the same
 * rules with no conversion.
 */
export interface LintablePolicy {
  access_mode?: "read_only" | "read_write";
  statement_rules?: { allow?: string[]; deny?: string[] };
  table_allowlist?: string[];
  table_denylist?: string[];
  masking_rules?: { table: string; column: string; kind: string }[];
  budget_queries_per_hour?: number;
  budget_queries_per_day?: number;
  max_rows?: number;
  statement_timeout_ms?: number;
  row_filters?: { table: string; predicate: string }[];
  write_mode?: "normal" | "rollback" | "sandbox";
  approval_mode?: "off" | "writes" | "ddl" | "all";
  approval_auto_max_rows?: number;
  approval_timeout_seconds?: number;
  migration_safety?: "off" | "warn" | "block";
  egress_bytes_per_day?: number;
  max_affected_rows?: number;
}

export interface LintSummary {
  error: number;
  warning: number;
  info: number;
}

function positive(n: number | undefined): boolean {
  return typeof n === "number" && n > 0;
}

function nonEmpty(arr: readonly unknown[] | undefined): boolean {
  return Array.isArray(arr) && arr.length > 0;
}

/** access_mode is read_only unless explicitly read_write (control-plane default). */
function effectiveAccessMode(p: LintablePolicy): "read_only" | "read_write" {
  return p.access_mode === "read_write" ? "read_write" : "read_only";
}

/** Normalize a relation reference for comparison: lowercased, trimmed. */
function normalizeRelation(relation: string): string {
  return relation.trim().toLowerCase();
}

/** Bare table name (segment after the last dot), used for schema-lenient matching. */
function bareName(relation: string): string {
  const normalized = normalizeRelation(relation);
  const dot = normalized.lastIndexOf(".");
  return dot >= 0 ? normalized.slice(dot + 1) : normalized;
}

/**
 * Whether two relation references plausibly name the same table. Matches on the
 * full normalized string or on the bare table name, so `public.users`,
 * `users`, and `USERS` are treated as the same target. Deliberately lenient:
 * for an advisory "this rule may be dead" check, under-flagging (missing a
 * genuinely-dead rule) is safer than falsely calling a live rule dead.
 */
function relationsMatch(a: string, b: string): boolean {
  return normalizeRelation(a) === normalizeRelation(b) || bareName(a) === bareName(b);
}

/**
 * Whether a relation is reachable under the policy's allow/deny lists:
 *  - a denylist match makes it unreachable (denylist wins), and
 *  - a non-empty allowlist with no match makes it unreachable.
 */
function relationReachable(p: LintablePolicy, relation: string): boolean {
  const denylist = p.table_denylist ?? [];
  if (denylist.some((entry) => relationsMatch(entry, relation))) {
    return false;
  }
  const allowlist = p.table_allowlist ?? [];
  if (allowlist.length > 0 && !allowlist.some((entry) => relationsMatch(entry, relation))) {
    return false;
  }
  return true;
}

/** Unique-preserving list of masking/row-filter table names that are unreachable. */
function unreachableTables(p: LintablePolicy, tables: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const table of tables) {
    if (relationReachable(p, table)) continue;
    const key = normalizeRelation(table);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(table);
  }
  return out;
}

/**
 * Lint a policy profile and return every finding, worst severity first. An
 * empty result means no risky combinations were detected.
 */
export function lintPolicy(p: LintablePolicy): LintFinding[] {
  const findings: LintFinding[] = [];
  const mode = effectiveAccessMode(p);
  const writeMode = p.write_mode ?? "normal";
  const approvalMode = p.approval_mode ?? "off";
  const hasMasking = nonEmpty(p.masking_rules);

  // R1: read-write with no allowlist can write anywhere.
  if (mode === "read_write" && !nonEmpty(p.table_allowlist)) {
    findings.push({
      code: "write-no-allowlist",
      severity: "warning",
      message:
        "Read-write access with no table_allowlist: the agent can write to every table in the database.",
      suggestion: "Add a table_allowlist to scope writes, or set access_mode to read_only.",
    });
  }

  // R2: writes commit directly with no affected-row cap and no approval.
  if (
    mode === "read_write" &&
    writeMode === "normal" &&
    !positive(p.max_affected_rows) &&
    approvalMode === "off"
  ) {
    findings.push({
      code: "unbounded-writes",
      severity: "warning",
      message:
        "Writes commit directly (write_mode normal) with no max_affected_rows cap and no approval_mode: a single UPDATE or DELETE can modify unlimited rows.",
      suggestion:
        "Set max_affected_rows, use write_mode rollback or sandbox, or enable approval_mode.",
    });
  }

  // R3: no query budget at all.
  if (!positive(p.budget_queries_per_hour) && !positive(p.budget_queries_per_day)) {
    findings.push({
      code: "no-query-budget",
      severity: "warning",
      message:
        "No query budget: budget_queries_per_hour and budget_queries_per_day are both unset, so a runaway or retrying agent can issue unlimited queries.",
      suggestion: "Set budget_queries_per_hour or budget_queries_per_day.",
    });
  }

  // R4: no read ceiling. Escalates to a warning when the policy masks columns,
  // since masking without a row/byte cap still lets an agent exfiltrate whole
  // tables.
  if (!positive(p.max_rows) && !positive(p.egress_bytes_per_day)) {
    findings.push(
      hasMasking
        ? {
            code: "no-read-ceiling",
            severity: "warning",
            message:
              "No read ceiling: max_rows and egress_bytes_per_day are both unset. This policy masks columns, but with no row or byte cap an agent can still read and exfiltrate entire tables.",
            suggestion:
              "Set max_rows or egress_bytes_per_day to bound how much a single credential can read.",
          }
        : {
            code: "no-read-ceiling",
            severity: "info",
            message:
              "No read ceiling: max_rows and egress_bytes_per_day are both unset, so a single query can return an entire table.",
            suggestion:
              "Set max_rows or egress_bytes_per_day to bound how much a single credential can read.",
          },
    );
  }

  // R5: masking rules on tables the policy makes unreachable never fire.
  const deadMaskTables = unreachableTables(
    p,
    (p.masking_rules ?? []).map((rule) => rule.table),
  );
  for (const table of deadMaskTables) {
    findings.push({
      code: "dead-mask-rule",
      severity: "info",
      message: `Masking rule on "${table}" may never apply: the table is not reachable under this policy's allowlist/denylist.`,
      suggestion:
        "Add the table to table_allowlist, or drop the masking rule if the table is intentionally blocked.",
    });
  }

  // R6: row filters on unreachable tables never fire.
  const deadFilterTables = unreachableTables(
    p,
    (p.row_filters ?? []).map((filter) => filter.table),
  );
  for (const table of deadFilterTables) {
    findings.push({
      code: "dead-row-filter",
      severity: "info",
      message: `Row filter on "${table}" may never apply: the table is not reachable under this policy's allowlist/denylist.`,
      suggestion: "Add the table to table_allowlist, or drop the row filter.",
    });
  }

  // R7: write/approval settings on a read-only policy are inert.
  if (mode === "read_only") {
    const inert: string[] = [];
    if (p.write_mode && p.write_mode !== "normal") inert.push(`write_mode=${p.write_mode}`);
    if (p.approval_mode && p.approval_mode !== "off")
      inert.push(`approval_mode=${p.approval_mode}`);
    if (positive(p.max_affected_rows)) inert.push("max_affected_rows");
    if (positive(p.approval_auto_max_rows)) inert.push("approval_auto_max_rows");
    if (inert.length > 0) {
      findings.push({
        code: "write-settings-on-readonly",
        severity: "info",
        message: `access_mode is read_only, so these write and approval settings have no effect: ${inert.join(", ")}.`,
        suggestion:
          "Remove these settings, or set access_mode to read_write if writes are intended.",
      });
    }
  }

  // R8: allowlist and denylist together are mostly redundant.
  if (nonEmpty(p.table_allowlist) && nonEmpty(p.table_denylist)) {
    findings.push({
      code: "allowlist-and-denylist",
      severity: "info",
      message:
        "Both table_allowlist and table_denylist are set. The allowlist already blocks everything not listed, so the denylist only affects tables that also appear in the allowlist.",
      suggestion:
        "Keep just the allowlist unless a specific allowlisted table must also be denied.",
    });
  }

  // R9: overlapping statement allow/deny.
  if (nonEmpty(p.statement_rules?.allow) && nonEmpty(p.statement_rules?.deny)) {
    findings.push({
      code: "allow-and-deny",
      severity: "info",
      message:
        "statement_rules has both allow and deny lists. Statement-kind deny takes precedence over allow.",
      suggestion: "Confirm the overlap is intended; a statement kind in both lists is denied.",
    });
  }

  return findings.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
}

/** Count findings by severity. */
export function summarizeFindings(findings: readonly LintFinding[]): LintSummary {
  const summary: LintSummary = { error: 0, warning: 0, info: 0 };
  for (const finding of findings) {
    summary[finding.severity] += 1;
  }
  return summary;
}

/** The worst severity among findings, or null when there are none. */
export function worstSeverity(findings: readonly LintFinding[]): LintSeverity | null {
  let worst: LintSeverity | null = null;
  for (const finding of findings) {
    if (worst === null || severityRank[finding.severity] < severityRank[worst]) {
      worst = finding.severity;
    }
  }
  return worst;
}
