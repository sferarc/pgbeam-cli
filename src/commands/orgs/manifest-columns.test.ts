import { describe, expect, it } from "vitest";
import { commandManifest } from "../../generated/manifest.gen.js";

/**
 * The same dropped-column defect `src/manifest-columns.test.ts` pins for `db`
 * and `projects`, checked here for the six organization membership commands.
 *
 * It lives in its own file rather than as more rows in that one because both
 * this branch and `main` created `src/manifest-columns.test.ts` independently,
 * which git cannot merge: an add/add has no common ancestor to diff against, so
 * any difference between the two copies is a whole-file conflict. Keeping that
 * file byte-identical to `main` and putting the organization rows next to the
 * commands they cover leaves nothing to hand-resolve, which matters because the
 * neighbouring `generated/manifest.gen.ts` must never be resolved by hand.
 *
 * `columnsFor` is repeated here for the same reason: importing it from the other
 * test file would run that file's suite twice, and moving it into a shared
 * helper would change `main`'s copy and bring the conflict back.
 */
describe("generated command manifest, organization commands", () => {
  const columnsFor = (command: string[]): string[] => {
    const entry = commandManifest.find(
      (c) => c.command.length === command.length && c.command.every((p, i) => p === command[i]),
    );
    if (!entry) throw new Error(`no generated command "${command.join(" ")}" in the manifest`);
    const { kind, columns } = entry.output;
    if (!columns) {
      throw new Error(`command "${command.join(" ")}" renders ${kind}, with no columns`);
    }
    return columns.map((c) => c.key);
  };

  it.each([
    // These commands exist to read and change a role, and `role` is a $ref to
    // the OrgRole enum, so all four dropped the one field they are for:
    // `set-role` could not show the role it had just set.
    { command: ["orgs", "members", "list"], field: "role" },
    { command: ["orgs", "members", "set-role"], field: "role" },
    { command: ["orgs", "invitations", "list"], field: "role" },
    { command: ["orgs", "invitations", "create"], field: "role" },
  ])("shows $field on `pgbeam $command`", ({ command, field }) => {
    expect(columnsFor(command)).toContain(field);
  });

  it("spends the member list's last column on user_id rather than an avatar URL", () => {
    // Seven scalar fields compete for six slots once `role` resolves, and the
    // priority list does not name `user_id` or `image`, so the order they were
    // declared in decides which one a user sees. Pin the outcome: `image` is a
    // URL nobody can click in a table, and `user_id` is the argument the other
    // member commands take.
    const columns = columnsFor(["orgs", "members", "list"]);
    expect(columns).toContain("user_id");
    expect(columns).not.toContain("image");
  });
});
