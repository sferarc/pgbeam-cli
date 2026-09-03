import { defineCommand } from "citty";
import { consola } from "consola";
import type { PolicyReplayInput } from "pgbeam";
import { requireProject, resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";
import { output } from "../../lib/output.js";
import { readDraftPolicyFile } from "../../lib/policy.js";

export default defineCommand({
  meta: {
    name: "replay",
    description: "Replay recorded agent traffic against a policy",
    docs: {
      longDescription:
        "Replay the project's recorded agent audit traffic against a candidate policy and print what would change: which queries that ran would now be blocked, which blocked queries would now be permitted, and which results would be masked or row-filtered. Supply exactly one of `--policy` (an existing saved policy ID) or `--draft` (a JSON file describing an unsaved draft policy). Traffic is deduplicated by normalized query shape, newest first, and every statement is evaluated through the data plane's own policy engine, so verdicts match real enforcement. The replay reads only the audit log; it never connects to the upstream database. By default it covers every credential in the project, including credentials bound to other policies, whose behaviour saving this candidate cannot change; pass `--bound-policy` to narrow it to the credentials a policy actually governs, which is usually the question you want answered before editing a live policy.",
      examples: [
        {
          comment: "Replay the last 7 days of traffic against a saved policy",
          command: "pgbeam policies replay --policy pol_xxx",
        },
        {
          comment: "Replay only the traffic the policy governs, before editing it",
          command: "pgbeam policies replay --draft ./policy.json --bound-policy pol_xxx",
        },
        {
          comment: "Replay one credential's traffic against a draft policy",
          command: "pgbeam policies replay --draft ./policy.json --credential cred_xxx",
        },
        {
          comment: "Replay a custom window and get the full result as JSON",
          command:
            "pgbeam policies replay --policy pol_xxx --start 2026-07-01T00:00:00Z --end 2026-07-08T00:00:00Z --json",
        },
      ],
      response:
        "Prints a summary (queries replayed, would-block/mask/row-filter counts, newly blocked and newly allowed changes) followed by the changed queries. With --json, returns the full result object including every per-query decision.",
    },
  },
  args: {
    ...globalArgs,
    policy: { type: "string", description: "ID of an existing saved policy to replay against" },
    draft: {
      type: "string",
      description: "Path to a JSON file with a draft policy body to replay against",
    },
    credential: {
      type: "string",
      description: "Restrict the replay to traffic recorded for one agent credential",
    },
    "bound-policy": {
      type: "string",
      description:
        "Restrict the replay to traffic from the credentials bound to this policy ID (mutually exclusive with --credential)",
    },
    start: {
      type: "string",
      description: "Start of the traffic window (RFC3339; default 7 days before the end)",
    },
    end: { type: "string", description: "End of the traffic window (RFC3339; default now)" },
    limit: {
      type: "string",
      description: "Maximum distinct queries to replay, newest first (1-500; default 200)",
    },
  },
  async run({ args }) {
    await runCommand(async () => {
      // Client-side validation (flag shape, draft file existence, parse, and
      // schema) runs before auth resolution, so a missing draft file reports
      // itself rather than an unrelated "Not authenticated" error.
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
      // Both narrow the traffic, and together they can return nothing for a
      // reason neither flag explains (a credential not bound to that policy).
      // An empty replay reads as "nothing changes", so refuse the combination.
      if (args.credential && args["bound-policy"]) {
        consola.error(
          "--credential and --bound-policy both narrow the replayed traffic. Pass only one.",
        );
        process.exit(1);
      }

      const body: PolicyReplayInput = {};
      if (args.policy) {
        body.policy_id = args.policy;
      } else if (args.draft) {
        body.policy = readDraftPolicyFile(args.draft) as PolicyReplayInput["policy"];
      }
      if (args.credential) {
        body.credential_id = args.credential;
      }
      if (args["bound-policy"]) {
        body.bound_policy_id = args["bound-policy"];
      }
      if (args.start) {
        body.start_ts = args.start;
      }
      if (args.end) {
        body.end_ts = args.end;
      }
      if (args.limit) {
        const limit = Number.parseInt(args.limit, 10);
        if (Number.isNaN(limit)) {
          consola.error("--limit must be an integer between 1 and 500.");
          process.exit(1);
        }
        body.limit = limit;
      }

      const ctx = resolveContext(args);
      const projectId = requireProject(ctx);

      const result = await ctx.client.policies.replayPolicy({
        pathParams: { project_id: projectId },
        body,
      });

      output(result, args.json, () => {
        const s = result.summary;
        const bound = s.bound_credentials ?? 0;
        const lines = [
          s.traffic_scope === "bound_credentials"
            ? `Scope: traffic from the ${bound} ${bound === 1 ? "credential" : "credentials"} bound to ${args["bound-policy"]}`
            : "Scope: every credential in the project (pass --bound-policy to narrow it to one policy's agents)",
          `Replayed ${s.evaluated} distinct queries (${s.entries_scanned} recorded entries)`,
          `Would allow: ${s.would_allow}  mask: ${s.would_mask}  row-filter: ${s.would_row_filter}  block: ${s.would_block}`,
          `Changes: ${s.newly_blocked} newly blocked, ${s.newly_allowed} newly allowed`,
        ];
        // A policy that binds nobody replays nothing. Say why, or the empty
        // result below reads as evidence the change is safe.
        if (s.traffic_scope === "bound_credentials" && bound === 0) {
          lines.push(
            "No agent credential is bound to that policy, so nothing was in scope. This result is not evidence the change is safe.",
          );
        }
        if (s.skipped_unparseable > 0) {
          lines.push(
            `Skipped ${s.skipped_unparseable} truncated statements (recorded too long to replay)`,
          );
        }
        if (s.truncated) {
          lines.push(
            "Window contained more distinct queries than the limit; only the newest were replayed.",
          );
        }
        const changed = result.items.filter(
          (i) => i.change === "newly_blocked" || i.change === "newly_allowed",
        );
        if (changed.length > 0) {
          lines.push("", "Changed queries:");
          for (const item of changed) {
            const label = item.change === "newly_blocked" ? "newly blocked" : "newly allowed";
            lines.push(`  [${label}] (${item.occurrences}x) ${item.sql}`);
            lines.push(`      ${item.result.rule}: ${item.result.reason}`);
          }
        } else {
          lines.push("", "No allow/block changes against recorded traffic.");
        }
        consola.log(lines.join("\n"));
      });
    });
  },
});
