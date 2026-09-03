/**
 * Credential capability card: what an agent credential can actually do, worked
 * out from the credential record plus the policy profile attached to it.
 *
 * Reading those two records side by side is not enough, because the data plane
 * resolves them against each other in a fixed order and a policy field can be
 * inert. The rules encoded here are transcribed from
 * `backend/services/proxy/policy/policy.go`:
 *
 *  - statement-kind deny beats allow, and a non-empty allow blocks every kind
 *    not listed;
 *  - `other` (a statement the analyzer could not classify) is refused unless it
 *    is explicitly allowlisted, in every access mode;
 *  - access_mode is a ceiling: a read_only credential refuses every write kind
 *    even when statement_rules.allow names it, and permits only select, show,
 *    explain and transaction unless another kind is explicitly allowlisted;
 *  - the denylist beats the allowlist, and a non-empty allowlist makes every
 *    unlisted relation unreachable;
 *  - budgets, caps and timeouts gate on `> 0`, so 0 or unset means unlimited.
 *
 * Pure and offline: the caller fetches the two records, this builds the card
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

/** Every statement kind the wire analyzer classifies (`protocol.StmtKind`). */
const statementKinds = [
  "select",
  "insert",
  "update",
  "delete",
  "ddl",
  "copy",
  "set",
  "show",
  "explain",
  "transaction",
  "other",
] as const;

type StatementKind = (typeof statementKinds)[number];

/** Kinds that mutate data or schema (`StmtKind.IsWrite`). */
const writeKinds = new Set<StatementKind>(["insert", "update", "delete", "ddl", "copy"]);

/** Kinds a read_only credential may use with no explicit allowlist entry. */
const readOnlyKinds = new Set<StatementKind>(["select", "show", "explain", "transaction"]);

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

interface StatementVerdict {
  kind: StatementKind;
  allowed: boolean;
  /** Why, in plain language. Empty when the kind is simply allowed. */
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

/** access_mode is read_only unless explicitly read_write (control-plane default). */
function effectiveAccessMode(policy: CapabilityPolicy): "read_only" | "read_write" {
  return policy.access_mode === "read_write" ? "read_write" : "read_only";
}

function decideStatement(
  kind: StatementKind,
  mode: "read_only" | "read_write",
  allow: readonly string[],
  deny: readonly string[],
): StatementVerdict {
  if (deny.includes(kind)) {
    return { kind, allowed: false, reason: "denied by statement_rules.deny" };
  }
  if (allow.length > 0 && !allow.includes(kind)) {
    return { kind, allowed: false, reason: "not in statement_rules.allow" };
  }
  // An unclassifiable statement fails closed in every access mode; the only
  // escape is an explicit "other" entry in the allowlist.
  if (kind === "other" && !allow.includes("other")) {
    return {
      kind,
      allowed: false,
      reason: 'unrecognized statements fail closed; allowlist "other" to permit them',
    };
  }
  if (mode === "read_only") {
    if (writeKinds.has(kind)) {
      return {
        kind,
        allowed: false,
        reason: "read_only is a ceiling, so the statement allowlist cannot lift it",
      };
    }
    if (!readOnlyKinds.has(kind) && !allow.includes(kind)) {
      return {
        kind,
        allowed: false,
        reason: `read_only permits select, show, explain and transaction only; allowlist "${kind}" to permit it`,
      };
    }
  }
  return { kind, allowed: true, reason: "" };
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

/** Build the capability card from a credential and the policy attached to it. */
export function buildCapabilityCard(
  credential: CapabilityCredential,
  policy: CapabilityPolicy,
  now: Date = new Date(),
): CapabilityCard {
  const mode = effectiveAccessMode(policy);
  const allow = policy.statement_rules?.allow ?? [];
  const deny = policy.statement_rules?.deny ?? [];
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
      statements: statementKinds.map((kind) => decideStatement(kind, mode, allow, deny)),
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
  // Group the refusals by reason so the card says why once, not eleven times.
  const byReason = new Map<string, StatementKind[]>();
  for (const verdict of access.statements) {
    if (verdict.allowed) continue;
    const kinds = byReason.get(verdict.reason) ?? [];
    kinds.push(verdict.kind);
    byReason.set(verdict.reason, kinds);
  }
  let first = true;
  for (const [reason, kinds] of byReason) {
    lines.push(keyValue(first ? "Blocked" : "", `${kinds.join(", ")} (${reason})`));
    first = false;
  }
  if (byReason.size === 0) {
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
