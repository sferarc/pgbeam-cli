import { defineCommand } from "citty";
import { consola } from "consola";
import { resolveAuthState, resolveContext } from "../../lib/client.js";
import { listProfiles } from "../../lib/config.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";
import { errorStatus } from "../../lib/orgs.js";
import { output, outputTable } from "../../lib/output.js";

export default defineCommand({
  meta: {
    name: "list",
    description: "List organizations visible to your credential",
    docs: {
      longDescription:
        "List the organizations your credential can access, fetched live from the API. An organization-scoped key (pbo_) shows exactly its own organization; an account key or session shows every organization you are a member of. The active organization is marked. When the API is unreachable, falls back to the organizations recorded in your locally saved profiles.",
      examples: [
        { comment: "List your organizations", command: "pgbeam orgs list" },
        { comment: "List organizations as JSON", command: "pgbeam orgs list --json" },
      ],
      response:
        "Displays a table with columns: active indicator, organization ID, name, slug, and your role. With `--json`, returns an array of organization entries.",
    },
  },
  args: {
    ...globalArgs,
  },
  async run({ args }) {
    await runCommand(async () => {
      const auth = resolveAuthState(args);

      if (auth.token) {
        try {
          const ctx = resolveContext(args);
          const result = await ctx.client.account.listOrganizations();
          const activeOrg = args.org ?? auth.orgId;
          const rows = result.organizations.map((o) => ({
            active: o.id === activeOrg ? "*" : "",
            id: o.id,
            name: o.name,
            slug: o.slug,
            role: o.role ?? "",
          }));

          if (rows.length === 0) {
            output([], args.json, () => {
              consola.info(
                "No organizations are visible to this credential. Create one in the dashboard at dash.pgbeam.com.",
              );
            });
            return;
          }

          output(rows, args.json, () => {
            outputTable(rows, [
              { key: "active", label: "" },
              { key: "id", label: "ID" },
              { key: "name", label: "Name" },
              { key: "slug", label: "Slug" },
              { key: "role", label: "Role" },
            ]);
          });
          return;
        } catch (err) {
          // HTTP errors (401 invalid key, ...) surface with remediation hints.
          // Only network-level failures fall back to the offline profile view.
          if (errorStatus(err) !== null) throw err;
          consola.warn("Could not reach the API. Showing organizations from saved profiles.");
        }
      }

      const profiles = listProfiles();
      const orgs = profiles
        .filter((p): p is typeof p & { profile: { orgId: string } } => Boolean(p.profile.orgId))
        .map((p) => ({
          profile: p.name,
          orgId: p.profile.orgId,
          active: p.active ? "*" : "",
        }));

      if (orgs.length === 0) {
        output([], args.json, () => {
          consola.info("No organizations configured. Set an org with `pgbeam orgs switch`.");
        });
        return;
      }

      output(orgs, args.json, () => {
        outputTable(orgs, [
          { key: "active", label: "" },
          { key: "profile", label: "Profile" },
          { key: "orgId", label: "Org ID" },
        ]);
      });
    });
  },
});
