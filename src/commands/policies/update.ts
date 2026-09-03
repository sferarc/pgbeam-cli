import { defineCommand } from "citty";
import { consola } from "consola";
import type { PolicyProfileInput } from "pgbeam";
import { parseEnum, parseNumber } from "../../lib/args.js";
import { requireProject, resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";
import { output, outputJson } from "../../lib/output.js";
import {
  assertValidPolicyInput,
  collectRepeatable,
  hasRepeatable,
  parseMaskFlag,
  readPolicyFile,
} from "../../lib/policy.js";

const accessModes = { read_only: "read_only", read_write: "read_write" } as const;
const writeModes = { normal: "normal", rollback: "rollback", sandbox: "sandbox" } as const;
const approvalModes = { off: "off", writes: "writes", ddl: "ddl", all: "all" } as const;
const migrationSafetyModes = { off: "off", warn: "warn", block: "block" } as const;

/** Split a comma-separated flag value into a trimmed, non-empty list. */
function parseList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export default defineCommand({
  meta: {
    name: "update",
    description: "Update a policy profile",
    docs: {
      longDescription:
        "Update a policy profile. Changes hot-reload to active agent sessions. Pass individual flags to change specific fields, or `--file` to supply the full profile body as JSON. Because the API replaces the whole profile, unspecified fields are read from the current profile first so single-flag edits are non-destructive. Fields set via `--file` are overlaid by any individual flags. The resolved profile is validated against the API schema before it is sent; `--dry-run` prints the resolved profile JSON without applying the update.",
      examples: [
        {
          comment: "Switch a profile to read-write",
          command: "pgbeam policies update pol_xxx --mode read_write",
        },
        {
          comment: "Restrict a profile to two tables",
          command: "pgbeam policies update pol_xxx --allow public.users --allow public.orders",
        },
        {
          comment: "Replace the masking rules and preview without applying",
          command: "pgbeam policies update pol_xxx --mask users.email=redact --dry-run",
        },
        {
          comment: "Cap daily budget and rows per query",
          command: "pgbeam policies update pol_xxx --budget-queries-per-day 5000 --max-rows 1000",
        },
        {
          comment: "Replace the full profile from a JSON file",
          command: "pgbeam policies update pol_xxx --file ./policy.json",
        },
      ],
      response: "Prints a success message. With --json, returns the updated policy profile.",
    },
  },
  args: {
    ...globalArgs,
    id: { type: "positional", description: "Policy profile ID", required: true },
    name: { type: "string", description: "New policy profile name" },
    mode: { type: "string", description: "Access mode: read_only or read_write" },
    "write-mode": {
      type: "string",
      description: "How writes are handled: normal, rollback, or sandbox",
    },
    "approval-mode": {
      type: "string",
      description: "Which statements need approval: off, writes, ddl, or all",
    },
    "approval-timeout-seconds": {
      type: "string",
      description: "How long a held statement waits for a decision before expiring",
    },
    "approval-auto-max-rows": {
      type: "string",
      description: "Statements touching at most this many rows are auto-approved (0 disables)",
    },
    "migration-safety": {
      type: "string",
      description: "Migration safety mode: off, warn, or block",
    },
    "table-allowlist": {
      type: "string",
      description: "Comma-separated relations to allow (replaces the current list)",
    },
    "table-denylist": {
      type: "string",
      description: "Comma-separated relations to deny (replaces the current list)",
    },
    allow: {
      type: "string",
      description:
        "Relation to allowlist (repeatable, or comma-separated; replaces the current list)",
    },
    deny: {
      type: "string",
      description:
        "Relation to denylist (repeatable, or comma-separated; replaces the current list)",
    },
    mask: {
      type: "string",
      description:
        "Masking rule as table.column=kind, where kind is redact, null, or hash (repeatable; replaces the current rules)",
    },
    "max-rows": { type: "string", description: "Max rows returned per query (0 means unlimited)" },
    "max-affected-rows": {
      type: "string",
      description:
        "Hard cap on rows a single write may affect; over-cap writes are rolled back and blocked (0 means unlimited)",
    },
    "budget-queries-per-hour": {
      type: "string",
      description: "Max queries per rolling hour (0 means unlimited)",
    },
    "budget-queries-per-day": {
      type: "string",
      description: "Max queries per day (0 means unlimited)",
    },
    "egress-bytes-per-day": {
      type: "string",
      description: "Per-day egress budget in bytes (0 means unlimited)",
    },
    "statement-timeout-ms": {
      type: "string",
      description: "Upstream statement timeout for agent sessions (0 uses the project default)",
    },
    file: { type: "string", description: "Path to a JSON file with the full profile body" },
    "dry-run": {
      type: "boolean",
      description:
        "Print the resolved profile JSON that would be sent, without applying the update",
      default: false,
    },
  },
  async run({ args, rawArgs }) {
    await runCommand(async () => {
      // Read and parse the --file body before auth resolution, so a missing or
      // malformed file reports itself rather than "Not authenticated". Schema
      // validation still runs on the resolved (current + file + flags) profile
      // below, which requires the fetch.
      const fileBody = args.file ? readPolicyFile(args.file) : null;

      const ctx = resolveContext(args);
      const projectId = requireProject(ctx);

      // The API replaces the whole profile, so start from the current one to
      // keep single-flag edits non-destructive.
      const current = await ctx.client.policies.getPolicyProfile({
        pathParams: { project_id: projectId, policy_id: args.id },
      });

      let body: PolicyProfileInput = {
        name: current.name,
        access_mode: current.access_mode,
        statement_rules: current.statement_rules,
        table_allowlist: current.table_allowlist,
        table_denylist: current.table_denylist,
        masking_rules: current.masking_rules,
        max_rows: current.max_rows,
        budget_queries_per_hour: current.budget_queries_per_hour,
        budget_queries_per_day: current.budget_queries_per_day,
        statement_timeout_ms: current.statement_timeout_ms,
        row_filters: current.row_filters,
        write_mode: current.write_mode,
        approval_mode: current.approval_mode,
        approval_auto_max_rows: current.approval_auto_max_rows,
        approval_timeout_seconds: current.approval_timeout_seconds,
        migration_safety: current.migration_safety,
        egress_bytes_per_day: current.egress_bytes_per_day,
        max_affected_rows: current.max_affected_rows,
      };

      if (fileBody) {
        body = { ...body, ...fileBody } as PolicyProfileInput;
      }

      let changed = false;
      const touch = () => {
        changed = true;
      };

      if (args.name) {
        body.name = args.name;
        touch();
      }
      if (args.mode) {
        body.access_mode = parseEnum(args.mode, accessModes, "mode");
        touch();
      }
      if (args["write-mode"]) {
        body.write_mode = parseEnum(args["write-mode"], writeModes, "write-mode");
        touch();
      }
      if (args["approval-mode"]) {
        body.approval_mode = parseEnum(args["approval-mode"], approvalModes, "approval-mode");
        touch();
      }
      if (args["approval-timeout-seconds"]) {
        body.approval_timeout_seconds = parseNumber(
          args["approval-timeout-seconds"],
          "approval-timeout-seconds",
        );
        touch();
      }
      if (args["approval-auto-max-rows"]) {
        body.approval_auto_max_rows = parseNumber(
          args["approval-auto-max-rows"],
          "approval-auto-max-rows",
        );
        touch();
      }
      if (args["migration-safety"]) {
        body.migration_safety = parseEnum(
          args["migration-safety"],
          migrationSafetyModes,
          "migration-safety",
        );
        touch();
      }
      if (typeof args["table-allowlist"] === "string") {
        body.table_allowlist = parseList(args["table-allowlist"]);
        touch();
      }
      if (typeof args["table-denylist"] === "string") {
        body.table_denylist = parseList(args["table-denylist"]);
        touch();
      }
      if (hasRepeatable("allow", rawArgs, args.allow)) {
        body.table_allowlist = collectRepeatable("allow", rawArgs, args.allow);
        touch();
      }
      if (hasRepeatable("deny", rawArgs, args.deny)) {
        body.table_denylist = collectRepeatable("deny", rawArgs, args.deny);
        touch();
      }
      if (hasRepeatable("mask", rawArgs, args.mask)) {
        body.masking_rules = collectRepeatable("mask", rawArgs, args.mask).map(parseMaskFlag);
        touch();
      }
      if (args["max-rows"]) {
        body.max_rows = parseNumber(args["max-rows"], "max-rows");
        touch();
      }
      if (args["max-affected-rows"]) {
        body.max_affected_rows = parseNumber(args["max-affected-rows"], "max-affected-rows");
        touch();
      }
      if (args["budget-queries-per-hour"]) {
        body.budget_queries_per_hour = parseNumber(
          args["budget-queries-per-hour"],
          "budget-queries-per-hour",
        );
        touch();
      }
      if (args["budget-queries-per-day"]) {
        body.budget_queries_per_day = parseNumber(
          args["budget-queries-per-day"],
          "budget-queries-per-day",
        );
        touch();
      }
      if (args["egress-bytes-per-day"]) {
        body.egress_bytes_per_day = parseNumber(
          args["egress-bytes-per-day"],
          "egress-bytes-per-day",
        );
        touch();
      }
      if (args["statement-timeout-ms"]) {
        body.statement_timeout_ms = parseNumber(
          args["statement-timeout-ms"],
          "statement-timeout-ms",
        );
        touch();
      }

      if (!changed && !args.file) {
        consola.error("Nothing to update. Pass at least one field flag or --file.");
        process.exit(1);
      }

      assertValidPolicyInput(body, args.file ? `--file ${args.file}` : "resolved profile");

      if (args["dry-run"]) {
        outputJson(body);
        consola.info(
          `Dry run: policy profile ${args.id} was not updated. Test statements against ` +
            'this profile with `pgbeam policies dry-eval --draft <file> --sql "..."`.',
        );
        return;
      }

      const p = await ctx.client.policies.updatePolicyProfile({
        pathParams: { project_id: projectId, policy_id: args.id },
        body,
      });

      output(p, args.json, () => {
        consola.success(`Policy profile ${p.id} updated.`);
      });
    });
  },
});
