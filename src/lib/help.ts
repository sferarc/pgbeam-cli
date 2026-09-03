import { type ArgsDef, type CommandDef, renderUsage } from "citty";
import type { CommandDocs } from "./flags.js";

/**
 * Custom help renderer passed to citty's runMain. citty's default usage screen
 * ignores the `meta.docs` block each command carries for the generated docs
 * site, so the well written examples never reached `--help`. This renders the
 * default usage and appends an EXAMPLES section when the command has any.
 */
export async function renderUsageWithExamples<T extends ArgsDef = ArgsDef>(
  cmd: CommandDef<T>,
  parent?: CommandDef<T>,
): Promise<string> {
  const usage = await renderUsage(cmd, parent);
  const meta = typeof cmd.meta === "function" ? await cmd.meta() : await cmd.meta;
  const docs = (meta as { docs?: CommandDocs } | undefined)?.docs;
  if (!docs?.examples?.length) return usage;

  const lines = ["", "EXAMPLES", ""];
  for (const example of docs.examples) {
    lines.push(`  # ${example.comment}`);
    lines.push(`  ${example.command}`);
    lines.push("");
  }
  return usage + lines.join("\n").trimEnd();
}

/** Drop-in replacement for citty's showUsage that includes examples. */
export async function showUsageWithExamples<T extends ArgsDef = ArgsDef>(
  cmd: CommandDef<T>,
  parent?: CommandDef<T>,
): Promise<void> {
  try {
    console.log(`${await renderUsageWithExamples(cmd, parent)}\n`);
  } catch (error) {
    console.error(error);
  }
}
