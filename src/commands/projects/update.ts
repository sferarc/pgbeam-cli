import { defineCommand } from "citty";
import { consola } from "consola";
import type { CidrEntry, UpdateProjectBody } from "pgbeam";
import { optionalArg, parseEnum } from "../../lib/args.js";
import { requireProject, resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";
import { output } from "../../lib/output.js";

const projectStatuses = {
  active: "active",
  suspended: "suspended",
  deleted: "deleted",
} as const;

/** Split a comma-separated flag value into a trimmed, non-empty list. */
function parseList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Parse a comma-separated CIDR list into CidrEntry objects. An empty value clears the allowlist. */
function parseCidrs(value: string): CidrEntry[] {
  return parseList(value).map((cidr) => ({ cidr }));
}

export default defineCommand({
  meta: {
    name: "update",
    description: "Update project settings",
    docs: {
      longDescription:
        "Update the settings of an existing project. If no project ID is provided, uses the linked project in the current directory. At least one update flag must be provided. `--agents-disabled` is the project kill-switch: setting it true blocks ALL agent-credential connections (live sessions drop within seconds); passthrough/human connections are unaffected. `--allowed-cidrs` replaces the IP allowlist; pass an empty string to allow all.",
      examples: [
        { comment: "Rename the linked project", command: "pgbeam projects update --name new-name" },
        {
          comment: "Engage the kill-switch (block all agents)",
          command: "pgbeam projects update --agents-disabled true",
        },
        {
          comment: "Restrict access to an office IP range",
          command: 'pgbeam projects update --allowed-cidrs "203.0.113.0/24,10.0.0.0/8"',
        },
        {
          comment: "Clear the IP allowlist (allow all)",
          command: 'pgbeam projects update --allowed-cidrs ""',
        },
        {
          comment: "Set the default policy for passthrough connections",
          command: "pgbeam projects update --default-policy-profile-id pol_xxx",
        },
        {
          comment: "Replace tags and description",
          command: 'pgbeam projects update --tags "prod,us-east-1" --description "Prod proxy"',
        },
      ],
      response:
        "Prints a success message confirming the project was updated. With `--json`, returns the updated project object.",
    },
  },
  args: {
    ...globalArgs,
    id: {
      type: "positional",
      description: "Project ID to update. Uses the linked project if omitted.",
      required: false,
    },
    name: {
      type: "string",
      description: "New display name for the project",
    },
    description: {
      type: "string",
      description: "New project description",
    },
    tags: {
      type: "string",
      description: "Comma-separated labels (replaces the current set)",
    },
    status: {
      type: "string",
      description: "Project lifecycle status: active, suspended, or deleted",
    },
    "allowed-cidrs": {
      type: "string",
      description:
        "Comma-separated CIDR ranges for the IP allowlist (replaces the current set). Pass an empty string to allow all.",
    },
    "default-policy-profile-id": {
      type: "string",
      description:
        "Policy profile enforced on passthrough/human connections. Pass an empty string to clear.",
    },
    "agents-disabled": {
      type: "string",
      description:
        "Project kill-switch. true blocks all agent-credential connections; false re-enables.",
    },
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);
      const projectId = optionalArg(args.id) ?? requireProject(ctx);

      const body: UpdateProjectBody = {};
      if (args.name) body.name = args.name;
      if (typeof args.description === "string") body.description = args.description;
      if (typeof args.tags === "string") body.tags = parseList(args.tags);
      if (args.status) body.status = parseEnum(args.status, projectStatuses, "status");
      if (typeof args["allowed-cidrs"] === "string") {
        body.allowed_cidrs = parseCidrs(args["allowed-cidrs"]);
      }
      if (typeof args["default-policy-profile-id"] === "string") {
        body.default_policy_profile_id = args["default-policy-profile-id"];
      }
      if (typeof args["agents-disabled"] === "string") {
        const value = args["agents-disabled"].toLowerCase();
        if (value !== "true" && value !== "false") {
          consola.error('Invalid --agents-disabled: expected "true" or "false".');
          process.exit(1);
        }
        body.agents_disabled = value === "true";
      }

      if (Object.keys(body).length === 0) {
        consola.error(
          "Nothing to update. Pass --name, --description, --tags, --status, --allowed-cidrs, --default-policy-profile-id, or --agents-disabled.",
        );
        process.exit(1);
      }

      const result = await ctx.client.projects.updateProject({
        pathParams: { project_id: projectId },
        body,
      });

      output(result, args.json, () => {
        consola.success(`Project ${projectId} updated.`);
        if (body.agents_disabled === true) {
          consola.warn("Kill-switch engaged: all agent-credential connections are now blocked.");
        } else if (body.agents_disabled === false) {
          consola.info("Kill-switch released: agent-credential connections are re-enabled.");
        }
      });
    });
  },
});
