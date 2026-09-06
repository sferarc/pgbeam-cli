import { describe, expect, it } from "vitest";
import { commandManifest } from "./generated/manifest.gen.js";

/**
 * The generator picks a table column by reading `type` off the response
 * property, and a property that points at a named schema is a `$ref` carrying
 * no `type`. Every such field was therefore dropped from the table, silently:
 * nothing failed, the manifest is checked in, and a column that never appeared
 * looks like a column nobody wanted.
 *
 * These are the fields that were missing. They are pinned by name because the
 * point is the output a user sees, not the resolution step that produces it: a
 * database list that does not say which databases are replicas, and a project
 * list that does not say whether a project is running, are wrong whatever the
 * generator does internally.
 */
describe("generated command manifest", () => {
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
    { command: ["db", "list"], field: "role" },
    { command: ["db", "inspect"], field: "role" },
    { command: ["db", "inspect"], field: "ssl_mode" },
    { command: ["projects", "list"], field: "status" },
    { command: ["projects", "inspect"], field: "status" },
    { command: ["projects", "inspect"], field: "residency" },
  ])("shows $field on `pgbeam $command`", ({ command, field }) => {
    expect(columnsFor(command)).toContain(field);
  });

  it("labels an acronym as one", () => {
    const sslMode = commandManifest
      .flatMap((c) => c.output.columns ?? [])
      .find((column) => column.key === "ssl_mode");
    expect(sslMode?.label).toBe("SSL Mode");
  });
});
