import { defineCommand } from "citty";
import { consola } from "consola";
import { requireProject, resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";
import { output } from "../../lib/output.js";
import { readDraftPolicyFile } from "../../lib/policy.js";
import {
  type LintablePolicy,
  lintPolicy,
  summarizeFindings,
  worstSeverity,
} from "../../lib/policy-lint.js";

const severityLabel: Record<string, string> = {
  error: "error",
  warning: "warn",
  info: "info",
};

export default defineCommand({
  meta: {
    name: "lint",
    description: "Check a policy profile for risky configuration",
    docs: {
      longDescription:
        "Statically check a policy profile for risky combinations before you attach it to a credential, without running any SQL. Supply exactly one of `--policy` (an existing saved policy ID) or `--draft` (a JSON file describing an unsaved draft policy). The linter reasons about the policy's own shape: it flags read-write access with no table allowlist, writes that commit with no affected-row cap or approval, missing query budgets, PII masking with no read ceiling, masking or row-filter rules on tables the policy makes unreachable, write settings that are inert on a read-only policy, and redundant allow/deny overlaps. It complements `policies dry-eval` (a single statement) and `policies replay` (recorded traffic). Pass `--strict` to exit non-zero when any warning-or-worse finding is present, for use as a CI gate.",
      examples: [
        {
          comment: "Lint a saved policy",
          command: "pgbeam policies lint --policy pol_xxx",
        },
        {
          comment: "Lint a draft policy file before creating it",
          command: "pgbeam policies lint --draft ./policy.json",
        },
        {
          comment: "Fail CI on any warning-or-worse finding",
          command: "pgbeam policies lint --policy pol_xxx --strict",
        },
        {
          comment: "Get findings as JSON",
          command: "pgbeam policies lint --policy pol_xxx --json",
        },
      ],
      response:
        "Prints each finding with its severity, code, message, and a suggested fix, then a summary count. With --json, returns { findings, summary }. With --strict, exits 1 when any warning or error finding is present.",
    },
  },
  args: {
    ...globalArgs,
    policy: { type: "string", description: "ID of an existing saved policy to lint" },
    draft: {
      type: "string",
      description: "Path to a JSON file with a draft policy body to lint",
    },
    strict: {
      type: "boolean",
      description: "Exit non-zero when any warning-or-worse finding is present",
      default: false,
    },
  },
  async run({ args }) {
    await runCommand(async () => {
      // Client-side flag validation runs before auth resolution, so a missing
      // draft file reports itself rather than an unrelated auth error, matching
      // `policies dry-eval`.
      if (!args.policy && !args.draft) {
        consola.error(
          "Supply exactly one of --policy (a saved policy ID) or --draft (a JSON file).",
        );
        process.exit(1);
      }
      if (args.policy && args.draft) {
        consola.error("--policy and --draft are mutually exclusive. Pass only one.");
        process.exit(1);
      }

      let policy: LintablePolicy;
      if (args.draft) {
        // Parse and schema-validate the draft client-side before any network call.
        policy = readDraftPolicyFile(args.draft) as LintablePolicy;
      } else {
        const ctx = resolveContext(args);
        const projectId = requireProject(ctx);
        policy = await ctx.client.policies.getPolicyProfile({
          pathParams: { project_id: projectId, policy_id: args.policy as string },
        });
      }

      const findings = lintPolicy(policy);
      const summary = summarizeFindings(findings);

      output({ findings, summary }, args.json, () => {
        if (findings.length === 0) {
          consola.success("No policy risks found.");
        } else {
          for (const finding of findings) {
            const label = severityLabel[finding.severity] ?? finding.severity;
            consola.log(`[${label}] ${finding.code}: ${finding.message}`);
            consola.log(`  Fix: ${finding.suggestion}`);
          }
          consola.log(
            `\n${summary.error} error(s), ${summary.warning} warning(s), ${summary.info} info.`,
          );
        }
      });

      // --strict turns a warning-or-worse result into a non-zero exit so the
      // command can gate CI. Info-only findings never fail.
      if (args.strict) {
        const worst = worstSeverity(findings);
        if (worst === "error" || worst === "warning") {
          process.exit(1);
        }
      }
    });
  },
});
