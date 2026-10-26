/**
 * Credential capability card: what an agent credential can actually do, worked
 * out from the credential record, the policy profile attached to it, and the
 * statement-kind verdicts the control plane computes for that policy.
 *
 * The verdicts come from `GET .../policies/{id}/statement-kinds`, which asks the
 * data plane's own policy engine, so the precedence rules (COPY refused by a
 * floor, deny beats allow, read_only as a ceiling, unclassified kinds failing
 * closed) live in Go only. Everything else here is read off the two records:
 * budgets, caps and timeouts gate on `> 0`, so 0 or unset means unlimited.
 *
 * Pure and offline: the caller fetches the three records, this builds the card
 * and renders it. The policy lint findings come from `policy-lint.ts`, so the
 * card carries the same warnings `pgbeam policies lint` would print.
 */

import { formatDate } from "./output.js";
import {
  type LintablePolicy,
  type LintFinding,
  type LintSummary,
  lintPolicy,
  summarizeFindings,
} from "./policy-lint.js";

/**
 * The subset of the credential record the card reads. The SDK `AgentCredential`
 * structurally satisfies it.
 */
export interface CapabilityCredential {
  id: string;
  name?: string;
  pg_username?: string;
  policy_profile_id?: string;
  status?: string;
  principal_type?: string;
  expires_at?: string | null;
  last_used_at?: string | null;
}

/** The subset of the policy record the card reads beyond the lintable fields. */
export interface CapabilityPolicy extends LintablePolicy {
  id?: string;
  name?: string;
}

/** The statement-kind answer the card reads. The SDK `PolicyStatementKinds` satisfies it. */
export interface CapabilityStatementKinds {
  access_mode: "read_only" | "read_write";
  statement_kinds: { kind: string; allowed: boolean; rule?: string; reason?: string }[];
}

interface StatementVerdict {
  kind: string;
  allowed: boolean;
  /** The engine's rule tag, null when the kind is allowed. */
  rule: string | null;
  /** The engine's reason, empty when the kind is allowed. */
  reason: string;
}

export interface CapabilityCard {
  credential: {
    id: string;
    name: string | null;
    pg_username: string | null;
    status: string;
    principal_type: string;
    expires_at: string | null;
    expired: boolean;
    last_used_at: string | null;
    /** Whether the credential can connect at all right now. */
    usable: boolean;
    /** Why it cannot connect, or null when it can. */
    unusable_reason: string | null;
  };
  policy: { id: string | null; name: string | null };
  access: {
    mode: "read_only" | "read_write";
    statements: StatementVerdict[];
  };
  tables: {
    allowlist: string[];
    denylist: string[];
    /** One sentence on what the two lists add up to. */
    reach: string;
  };
  masking: { table: string; column: string; kind: string }[];
  row_filters: { table: string; predicate: string }[];
  budgets: {
    queries_per_hour: number;
    queries_per_day: number;
    max_rows: number;
    egress_bytes_per_day: number;
    statement_timeout_ms: number;
  };
  writes: {
    write_mode: string;
    approval_mode: string;
    approval_auto_max_rows: number;
    approval_timeout_seconds: number;
    max_affected_rows: number;
    migration_safety: string;
  } | null;
  findings: LintFinding[];
  summary: LintSummary;
}

function describeReach(allowlist: readonly string[], denylist: readonly string[]): string {
  if (allowlist.length > 0 && denylist.length > 0) {
    return `Only the ${allowlist.length} allowlisted relation(s), minus any the denylist also names.`;
  }
  if (allowlist.length > 0) {
    return `Only the ${allowlist.length} allowlisted relation(s). Everything else is unreachable.`;
  }
  if (denylist.length > 0) {
    return `Every relation in the database except the ${denylist.length} on the denylist.`;
  }
  return "Every relation in the database. No allowlist is set.";
}

/** Build the capability card from a credential, its policy and that policy's statement-kind verdicts. */
export function buildCapabilityCard(
  credential: CapabilityCredential,
  policy: CapabilityPolicy,
  kinds: CapabilityStatementKinds,
  now: Date = new Date(),
): CapabilityCard {
  const mode = kinds.access_mode;
  const allowlist = policy.table_allowlist ?? [];
  const denylist = policy.table_denylist ?? [];

  const status = credential.status ?? "unknown";
  const expiresAt = credential.expires_at ?? null;
  const expired = expiresAt !== null && new Date(expiresAt).getTime() <= now.getTime();

  let unusableReason: string | null = null;
  if (status === "revoked") {
    unusableReason = "the credential is revoked and cannot be re-enabled";
  } else if (status === "disabled") {
    unusableReason = "the credential is disabled (kill-switch); `pgbeam agents enable` restores it";
  } else if (expired) {
    unusableReason = "the credential expired, and expiry is enforced fail-closed in the proxy";
  } else if (status !== "active") {
    unusableReason = `the credential's status is "${status}", not active`;
  }

  const findings = lintPolicy(policy);

  return {
    credential: {
      id: credential.id,
      name: credential.name ?? null,
      pg_username: credential.pg_username ?? null,
      status,
      principal_type: credential.principal_type ?? "agent",
      expires_at: expiresAt,
      expired,
      last_used_at: credential.last_used_at ?? null,
      usable: unusableReason === null,
      unusable_reason: unusableReason,
    },
    policy: { id: policy.id ?? credential.policy_profile_id ?? null, name: policy.name ?? null },
    access: {
      mode,
      statements: kinds.statement_kinds.map((v) => ({
        kind: v.kind,
        allowed: v.allowed,
        rule: v.allowed ? null : (v.rule ?? null),
        reason: v.allowed ? "" : (v.reason ?? ""),
      })),
    },
    tables: {
      allowlist: [...allowlist],
      denylist: [...denylist],
      reach: describeReach(allowlist, denylist),
    },
    masking: (policy.masking_rules ?? []).map((rule) => ({ ...rule })),
    row_filters: (policy.row_filters ?? []).map((filter) => ({ ...filter })),
    budgets: {
      queries_per_hour: policy.budget_queries_per_hour ?? 0,
      queries_per_day: policy.budget_queries_per_day ?? 0,
      max_rows: policy.max_rows ?? 0,
      egress_bytes_per_day: policy.egress_bytes_per_day ?? 0,
      statement_timeout_ms: policy.statement_timeout_ms ?? 0,
    },
    writes:
      mode === "read_write"
        ? {
            write_mode: policy.write_mode ?? "normal",
            approval_mode: policy.approval_mode ?? "off",
            approval_auto_max_rows: policy.approval_auto_max_rows ?? 0,
            approval_timeout_seconds: policy.approval_timeout_seconds ?? 300,
            max_affected_rows: policy.max_affected_rows ?? 0,
            migration_safety: policy.migration_safety ?? "off",
          }
        : null,
    findings,
    summary: summarizeFindings(findings),
  };
}

/** Render a limit where 0 or unset means no limit. */
function limit(value: number, unit: string): string {
  return value > 0 ? `${value.toLocaleString("en-US")} ${unit}` : "unlimited";
}

function pad(label: string, width: number): string {
  return label.padEnd(width);
}

const LABEL_WIDTH = 20;

function keyValue(label: string, value: string): string {
  return `  ${pad(label, LABEL_WIDTH)}${value}`;
}

/** An indented line with no key, for a note under a heading. */
function note(text: string): string {
  return `  ${text}`;
}

const severityLabel: Record<string, string> = { error: "error", warning: "warn", info: "info" };

/** One operator-facing sentence per kind-level rule tag from `policy.go`. Wording only. */
const ruleExplanation: Record<string, string> = {
  copy_blocked: "COPY is blocked for agent credentials; use SELECT",
  statement_denied: "denied by statement_rules.deny",
  statement_not_allowed: "not in statement_rules.allow",
  unknown_statement: 'unrecognized statements fail closed; allowlist "other" to permit them',
  read_only:
    "read_only is a ceiling the allowlist cannot lift for a write; a non-write kind beyond select, show, explain and transaction needs an allowlist entry",
};

/**
 * Render the card as plain lines for stdout. Kept separate from the command so
 * the rendering is testable without a terminal, and returns lines rather than
 * printing so the caller owns the output channel.
 */
export function formatCapabilityCard(card: CapabilityCard, now: Date = new Date()): string[] {
  const lines: string[] = [];
  const { credential, policy, access, tables, budgets, writes } = card;

  const title = credential.name ? `${credential.id} "${credential.name}"` : credential.id;
  lines.push(`Credential ${title}`);
  lines.push(keyValue("Status", credential.usable ? "active" : `${credential.status} (unusable)`));
  if (!credential.usable && credential.unusable_reason) {
    lines.push(note(`Cannot connect: ${credential.unusable_reason}.`));
  }
  lines.push(keyValue("Postgres user", credential.pg_username ?? "-"));
  lines.push(keyValue("Principal", credential.principal_type));
  lines.push(
    keyValue("Expires", credential.expires_at ? formatDate(credential.expires_at, now) : "never"),
  );
  lines.push(
    keyValue(
      "Last used",
      credential.last_used_at ? formatDate(credential.last_used_at, now) : "never",
    ),
  );
  const policyTitle = policy.name ? `${policy.id ?? "-"} "${policy.name}"` : (policy.id ?? "-");
  lines.push(keyValue("Policy", policyTitle));

  lines.push("");
  lines.push(`Statements (access_mode ${access.mode})`);
  const allowedKinds = access.statements.filter((s) => s.allowed).map((s) => s.kind);
  lines.push(keyValue("Allowed", allowedKinds.length > 0 ? allowedKinds.join(", ") : "none"));
  // Group the refusals by rule so the card says why once, not eleven times. The
  // engine's reason names the kind, so it is the fallback for a rule not listed.
  const byRule = new Map<string, { kinds: string[]; why: string }>();
  for (const verdict of access.statements) {
    if (verdict.allowed) continue;
    const key = verdict.rule ?? verdict.reason;
    const group = byRule.get(key) ?? {
      kinds: [],
      why: (verdict.rule && ruleExplanation[verdict.rule]) || verdict.reason,
    };
    group.kinds.push(verdict.kind);
    byRule.set(key, group);
  }
  let first = true;
  for (const { kinds, why } of byRule.values()) {
    lines.push(keyValue(first ? "Blocked" : "", `${kinds.join(", ")} (${why})`));
    first = false;
  }
  if (byRule.size === 0) {
    lines.push(keyValue("Blocked", "none"));
  }

  lines.push("");
  lines.push("Relations");
  lines.push(
    keyValue("Allowlist", tables.allowlist.length > 0 ? tables.allowlist.join(", ") : "(empty)"),
  );
  lines.push(
    keyValue("Denylist", tables.denylist.length > 0 ? tables.denylist.join(", ") : "(empty)"),
  );
  lines.push(keyValue("Reach", tables.reach));

  lines.push("");
  lines.push(`Masked columns (${card.masking.length})`);
  if (card.masking.length === 0) {
    lines.push(note("None: every column in reach is returned in the clear."));
  } else {
    for (const rule of card.masking) {
      lines.push(keyValue(`${rule.table}.${rule.column}`, rule.kind));
    }
  }

  if (card.row_filters.length > 0) {
    lines.push("");
    lines.push(`Row filters (${card.row_filters.length})`);
    for (const filter of card.row_filters) {
      lines.push(keyValue(filter.table, filter.predicate));
    }
  }

  lines.push("");
  lines.push("Budgets");
  lines.push(keyValue("Queries per hour", limit(budgets.queries_per_hour, "queries")));
  lines.push(keyValue("Queries per day", limit(budgets.queries_per_day, "queries")));
  lines.push(keyValue("Rows per query", limit(budgets.max_rows, "rows")));
  lines.push(keyValue("Egress per day", limit(budgets.egress_bytes_per_day, "bytes")));
  // 0 here is not "unlimited": the proxy falls back to the project's own
  // statement timeout, so say that rather than implying no limit at all.
  lines.push(
    keyValue(
      "Statement timeout",
      budgets.statement_timeout_ms > 0
        ? `${budgets.statement_timeout_ms.toLocaleString("en-US")} ms`
        : "the project default",
    ),
  );

  if (writes) {
    lines.push("");
    lines.push("Writes");
    lines.push(keyValue("Write mode", writes.write_mode));
    lines.push(keyValue("Approval mode", writes.approval_mode));
    if (writes.approval_mode !== "off") {
      lines.push(keyValue("Auto-approve up to", limit(writes.approval_auto_max_rows, "rows")));
      lines.push(keyValue("Approval timeout", `${writes.approval_timeout_seconds}s`));
    }
    lines.push(keyValue("Rows per write", limit(writes.max_affected_rows, "rows")));
    lines.push(keyValue("Migration safety", writes.migration_safety));
  }

  lines.push("");
  lines.push("Always blocked, whatever the policy says");
  lines.push(
    note(
      "DO blocks, and the filesystem, program, large-object, replication, dblink, XML-export and sleep function families.",
    ),
  );
  if (access.mode === "read_write") {
    lines.push(note("DROP and TRUNCATE, and UPDATE or DELETE with no WHERE clause."));
  }

  lines.push("");
  if (card.findings.length === 0) {
    lines.push("Policy warnings: none.");
  } else {
    lines.push(`Policy warnings (${card.findings.length})`);
    for (const finding of card.findings) {
      const label = severityLabel[finding.severity] ?? finding.severity;
      lines.push(`  [${label}] ${finding.code}: ${finding.message}`);
      lines.push(`    Fix: ${finding.suggestion}`);
    }
  }

  return lines;
}
