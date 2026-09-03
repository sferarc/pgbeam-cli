import { defineCommand } from "citty";
import { consola } from "consola";
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

/** Numeric budget and limit flags, mapped to their PolicyProfileInput fields. */
const numericFlags = {
  "max-rows": "max_rows",
  "max-affected-rows": "max_affected_rows",
  "budget-queries-per-hour": "budget_queries_per_hour",
  "budget-queries-per-day": "budget_queries_per_day",
  "egress-bytes-per-day": "egress_bytes_per_day",
  "statement-timeout-ms": "statement_timeout_ms",
  "approval-timeout-seconds": "approval_timeout_seconds",
  "approval-auto-max-rows": "approval_auto_max_rows",
} as const;

/** Split a comma-separated flag value into a trimmed, non-empty list. */
function parseList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export default defineCommand({
  meta: {
    name: "create",
    description: "Create a policy profile",
    docs: {
      longDescription:
        "Create a policy profile. Provide a name and access mode, then author the rules with flags (`--allow`, `--deny`, `--mask`, budget flags, and the write-safety flags `--write-mode`, `--approval-mode`, `--approval-timeout-seconds`, `--approval-auto-max-rows`, `--migration-safety`) or pass a JSON file describing the full profile (statement rules, allow/deny lists, masking, budgets). Fields set via `--file` are overlaid by any individual flags. The resolved profile is validated against the API schema before anything is sent; `--dry-run` prints the resolved profile JSON without calling the API.",
      examples: [
        {
          comment: "Create a read-only profile",
          command: 'pgbeam policies create --name "read-only" --mode read_only',
        },
        {
          comment: "Allowlist two tables and mask a column",
          command:
            "pgbeam policies create --name support --allow public.users --allow public.orders --mask users.email=redact",
        },
        {
          comment: "Cap budgets and rows",
          command:
            "pgbeam policies create --name bots --budget-queries-per-day 5000 --max-rows 1000 --statement-timeout-ms 3000",
        },
        {
          comment: "Read-write profile with rollback writes and approval for DDL",
          command:
            "pgbeam policies create --name deploys --mode read_write --write-mode rollback --approval-mode ddl --migration-safety warn",
        },
        {
          comment: "Preview the resolved profile without creating it",
          command: "pgbeam policies create --name analytics --file ./policy.json --dry-run",
        },
      ],
      response:
        "Prints the created policy profile. With --dry-run, prints the resolved profile JSON that would be sent and exits without calling the API.",
    },
  },
  args: {
    ...globalArgs,
    name: { type: "string", description: "Policy profile name", required: true },
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
      description: "Comma-separated relations to allow",
    },
    "table-denylist": {
      type: "string",
      description: "Comma-separated relations to deny",
    },
    allow: {
      type: "string",
      description: "Relation to allowlist (repeatable, or comma-separated)",
    },
    deny: {
      type: "string",
      description: "Relation to denylist (repeatable, or comma-separated)",
    },
    mask: {
      type: "string",
      description:
        "Masking rule as table.column=kind, where kind is redact, null, or hash (repeatable)",
    },
    "max-rows": {
      type: "string",
      description: "Max rows returned per query (0 means unlimited)",
    },
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
      description: "Print the resolved profile JSON that would be sent, without calling the API",
      default: false,
    },
  },
  async run({ args, rawArgs }) {
    await runCommand(async () => {
      let body: Record<string, unknown> = {};
      if (args.file) {
        body = readPolicyFile(args.file);
        assertValidPolicyInput({ ...body, name: args.name }, `--file ${args.file}`);
      }
      body.name = args.name;

      if (args.mode) {
        body.access_mode = parseEnum(args.mode, accessModes, "mode");
      }
      if (args["write-mode"]) {
        body.write_mode = parseEnum(args["write-mode"], writeModes, "write-mode");
      }
      if (args["approval-mode"]) {
        body.approval_mode = parseEnum(args["approval-mode"], approvalModes, "approval-mode");
      }
      if (args["migration-safety"]) {
        body.migration_safety = parseEnum(
          args["migration-safety"],
          migrationSafetyModes,
          "migration-safety",
        );
      }
      if (typeof args["table-allowlist"] === "string") {
        body.table_allowlist = parseList(args["table-allowlist"]);
      }
      if (typeof args["table-denylist"] === "string") {
        body.table_denylist = parseList(args["table-denylist"]);
      }
      if (hasRepeatable("allow", rawArgs, args.allow)) {
        body.table_allowlist = collectRepeatable("allow", rawArgs, args.allow);
      }
      if (hasRepeatable("deny", rawArgs, args.deny)) {
        body.table_denylist = collectRepeatable("deny", rawArgs, args.deny);
      }
      if (hasRepeatable("mask", rawArgs, args.mask)) {
        body.masking_rules = collectRepeatable("mask", rawArgs, args.mask).map(parseMaskFlag);
      }
      for (const [flag, field] of Object.entries(numericFlags)) {
        const value = args[flag];
        if (typeof value === "string" && value !== "") {
          body[field] = parseNumber(value, flag);
        }
      }

      assertValidPolicyInput(body, "resolved profile");

      if (args["dry-run"]) {
        outputJson(body);
        consola.info(
          "Dry run: nothing was sent. Test statements against this profile with " +
            '`pgbeam policies dry-eval --draft <file> --sql "..."`.',
        );
        return;
      }

      const ctx = resolveContext(args);
      const projectId = requireProject(ctx);

      const p = await ctx.client.policies.createPolicyProfile({
        pathParams: { project_id: projectId },
        // biome-ignore lint/suspicious/noExplicitAny: body is validated against the contract-derived schema above
        body: body as any,
      });

      output(p, args.json, () => {
        consola.success(`Policy profile created: ${p.id}`);
      });
    });
  },
});
