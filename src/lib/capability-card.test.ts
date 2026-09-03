import { describe, expect, it } from "vitest";
import {
  buildCapabilityCard,
  type CapabilityCredential,
  type CapabilityPolicy,
  formatCapabilityCard,
} from "./capability-card.js";

const NOW = new Date("2026-08-24T12:00:00.000Z");

const credential: CapabilityCredential = {
  id: "agt_1",
  name: "analytics reader",
  pg_username: "agent_a1b2c3",
  policy_profile_id: "pol_1",
  status: "active",
  principal_type: "agent",
  expires_at: null,
  last_used_at: "2026-08-23T12:00:00.000Z",
};

const readOnlyPolicy: CapabilityPolicy = {
  id: "pol_1",
  name: "Read-only analytics",
  access_mode: "read_only",
  table_allowlist: ["users", "orders"],
  max_rows: 1000,
  budget_queries_per_hour: 200,
};

function verdict(card: ReturnType<typeof buildCapabilityCard>, kind: string) {
  const found = card.access.statements.find((s) => s.kind === kind);
  if (!found) throw new Error(`no verdict for ${kind}`);
  return found;
}

describe("buildCapabilityCard", () => {
  it("reports a healthy read-only credential as usable", () => {
    const card = buildCapabilityCard(credential, readOnlyPolicy, NOW);
    expect(card.credential.usable).toBe(true);
    expect(card.credential.unusable_reason).toBeNull();
    expect(card.credential.expired).toBe(false);
    expect(card.policy).toEqual({ id: "pol_1", name: "Read-only analytics" });
  });

  it("permits only the read kinds under read_only", () => {
    const card = buildCapabilityCard(credential, readOnlyPolicy, NOW);
    const allowed = card.access.statements.filter((s) => s.allowed).map((s) => s.kind);
    expect(allowed).toEqual(["select", "show", "explain", "transaction"]);
  });

  it("keeps a write blocked under read_only even when the allowlist names it", () => {
    // access_mode is a ceiling in the data plane: statement_rules.allow narrows
    // within it and never widens past it.
    const card = buildCapabilityCard(
      credential,
      { ...readOnlyPolicy, statement_rules: { allow: ["select", "delete"] } },
      NOW,
    );
    const del = verdict(card, "delete");
    expect(del.allowed).toBe(false);
    expect(del.reason).toContain("ceiling");
  });

  it("permits a write under read_write with the same allowlist", () => {
    const card = buildCapabilityCard(
      credential,
      {
        ...readOnlyPolicy,
        access_mode: "read_write",
        statement_rules: { allow: ["select", "delete"] },
      },
      NOW,
    );
    expect(verdict(card, "delete").allowed).toBe(true);
    expect(verdict(card, "insert").allowed).toBe(false);
    expect(verdict(card, "insert").reason).toBe("not in statement_rules.allow");
  });

  it("lets deny beat allow", () => {
    const card = buildCapabilityCard(
      credential,
      { ...readOnlyPolicy, statement_rules: { allow: ["select"], deny: ["select"] } },
      NOW,
    );
    expect(verdict(card, "select").allowed).toBe(false);
    expect(verdict(card, "select").reason).toBe("denied by statement_rules.deny");
  });

  it("blocks unclassified statements unless `other` is explicitly allowlisted", () => {
    const closed = buildCapabilityCard(credential, readOnlyPolicy, NOW);
    expect(verdict(closed, "other").allowed).toBe(false);
    expect(verdict(closed, "other").reason).toContain("fail closed");

    const opened = buildCapabilityCard(
      credential,
      { ...readOnlyPolicy, statement_rules: { allow: ["select", "other"] } },
      NOW,
    );
    expect(verdict(opened, "other").allowed).toBe(true);
  });

  it("permits `set` under read_only only when it is allowlisted", () => {
    const closed = buildCapabilityCard(credential, readOnlyPolicy, NOW);
    expect(verdict(closed, "set").allowed).toBe(false);

    const opened = buildCapabilityCard(
      credential,
      { ...readOnlyPolicy, statement_rules: { allow: ["select", "set"] } },
      NOW,
    );
    expect(verdict(opened, "set").allowed).toBe(true);
  });

  it("treats an unset access_mode as read_only", () => {
    const card = buildCapabilityCard(credential, { id: "pol_1" }, NOW);
    expect(card.access.mode).toBe("read_only");
    expect(verdict(card, "update").allowed).toBe(false);
  });

  it("marks an expired credential unusable", () => {
    const card = buildCapabilityCard(
      { ...credential, expires_at: "2026-08-24T11:00:00.000Z" },
      readOnlyPolicy,
      NOW,
    );
    expect(card.credential.expired).toBe(true);
    expect(card.credential.usable).toBe(false);
    expect(card.credential.unusable_reason).toContain("expired");
  });

  it("marks a disabled credential unusable and names the kill-switch", () => {
    const card = buildCapabilityCard({ ...credential, status: "disabled" }, readOnlyPolicy, NOW);
    expect(card.credential.usable).toBe(false);
    expect(card.credential.unusable_reason).toContain("disabled");
  });

  it("marks a revoked credential unusable", () => {
    const card = buildCapabilityCard({ ...credential, status: "revoked" }, readOnlyPolicy, NOW);
    expect(card.credential.usable).toBe(false);
    expect(card.credential.unusable_reason).toContain("revoked");
  });

  it("describes reach for each allowlist/denylist combination", () => {
    expect(
      buildCapabilityCard(credential, { table_allowlist: ["users"] }, NOW).tables.reach,
    ).toContain("Only the 1 allowlisted");
    expect(
      buildCapabilityCard(credential, { table_denylist: ["secrets"] }, NOW).tables.reach,
    ).toContain("except the 1 on the denylist");
    expect(buildCapabilityCard(credential, {}, NOW).tables.reach).toContain("Every relation");
    expect(
      buildCapabilityCard(
        credential,
        { table_allowlist: ["users"], table_denylist: ["users"] },
        NOW,
      ).tables.reach,
    ).toContain("minus any the denylist");
  });

  it("omits the writes block on a read-only policy and fills it on read_write", () => {
    expect(buildCapabilityCard(credential, readOnlyPolicy, NOW).writes).toBeNull();
    const rw = buildCapabilityCard(
      credential,
      { ...readOnlyPolicy, access_mode: "read_write", max_affected_rows: 100 },
      NOW,
    );
    expect(rw.writes).toMatchObject({
      write_mode: "normal",
      approval_mode: "off",
      max_affected_rows: 100,
      approval_timeout_seconds: 300,
    });
  });

  it("carries the policy lint findings and their summary", () => {
    const card = buildCapabilityCard(credential, { access_mode: "read_write" }, NOW);
    const codes = card.findings.map((f) => f.code);
    expect(codes).toContain("write-no-allowlist");
    expect(codes).toContain("no-query-budget");
    expect(card.summary.warning).toBeGreaterThan(0);
  });

  it("finds no lint findings on a tightly scoped policy", () => {
    const card = buildCapabilityCard(credential, readOnlyPolicy, NOW);
    expect(card.findings).toEqual([]);
    expect(card.summary).toEqual({ error: 0, warning: 0, info: 0 });
  });
});

describe("formatCapabilityCard", () => {
  it("renders the sections a card needs", () => {
    const text = formatCapabilityCard(
      buildCapabilityCard(credential, readOnlyPolicy, NOW),
      NOW,
    ).join("\n");
    expect(text).toContain('Credential agt_1 "analytics reader"');
    expect(text).toContain("Statements (access_mode read_only)");
    expect(text).toContain("select, show, explain, transaction");
    expect(text).toContain("Relations");
    expect(text).toContain("Masked columns (0)");
    expect(text).toContain("Budgets");
    expect(text).toContain("Always blocked, whatever the policy says");
    expect(text).toContain("Policy warnings: none.");
  });

  it("renders 0 and unset limits as unlimited", () => {
    const text = formatCapabilityCard(
      buildCapabilityCard(credential, { ...readOnlyPolicy, max_rows: 0 }, NOW),
      NOW,
    ).join("\n");
    expect(text).toContain("Rows per query      unlimited");
    expect(text).toContain("Queries per hour    200 queries");
  });

  it("renders an unset statement timeout as the project default, not unlimited", () => {
    // 0 means "use the project's own timeout" for this field only, so calling it
    // unlimited would be wrong.
    const text = formatCapabilityCard(
      buildCapabilityCard(credential, readOnlyPolicy, NOW),
      NOW,
    ).join("\n");
    expect(text).toContain("Statement timeout   the project default");

    const set = formatCapabilityCard(
      buildCapabilityCard(credential, { ...readOnlyPolicy, statement_timeout_ms: 30000 }, NOW),
      NOW,
    ).join("\n");
    expect(set).toContain("Statement timeout   30,000 ms");
  });

  it("leads with why an unusable credential cannot connect", () => {
    const text = formatCapabilityCard(
      buildCapabilityCard({ ...credential, status: "disabled" }, readOnlyPolicy, NOW),
      NOW,
    ).join("\n");
    expect(text).toContain("disabled (unusable)");
    expect(text).toContain("Cannot connect:");
  });

  it("groups blocked statement kinds by their reason", () => {
    const lines = formatCapabilityCard(buildCapabilityCard(credential, readOnlyPolicy, NOW), NOW);
    const blocked = lines.filter((line) => line.includes("ceiling"));
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toContain("insert, update, delete, ddl, copy");
  });

  it("lists masked columns and row filters when the policy has them", () => {
    const text = formatCapabilityCard(
      buildCapabilityCard(
        credential,
        {
          ...readOnlyPolicy,
          masking_rules: [{ table: "users", column: "email", kind: "redact" }],
          row_filters: [{ table: "orders", predicate: "tenant_id = 1" }],
        },
        NOW,
      ),
      NOW,
    ).join("\n");
    expect(text).toContain("Masked columns (1)");
    expect(text).toContain("users.email");
    expect(text).toContain("redact");
    expect(text).toContain("Row filters (1)");
    expect(text).toContain("tenant_id = 1");
  });

  it("prints the write floor only for a read-write credential", () => {
    const readOnly = formatCapabilityCard(
      buildCapabilityCard(credential, readOnlyPolicy, NOW),
      NOW,
    ).join("\n");
    expect(readOnly).not.toContain("DROP and TRUNCATE");

    const readWrite = formatCapabilityCard(
      buildCapabilityCard(credential, { ...readOnlyPolicy, access_mode: "read_write" }, NOW),
      NOW,
    ).join("\n");
    expect(readWrite).toContain("DROP and TRUNCATE");
    expect(readWrite).toContain("Writes");
  });

  it("prints lint findings with their fix", () => {
    const text = formatCapabilityCard(
      buildCapabilityCard(credential, { access_mode: "read_write" }, NOW),
      NOW,
    ).join("\n");
    expect(text).toContain("Policy warnings (");
    expect(text).toContain("[warn] write-no-allowlist:");
    expect(text).toContain("Fix:");
  });
});
