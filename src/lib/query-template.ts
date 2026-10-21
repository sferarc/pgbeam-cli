import { readFileSync } from "node:fs";
import type { QueryTemplateParam, QueryTemplateParamTypeKey } from "pgbeam";
import { optionalArg, parseEnum } from "./args.js";
import { collectRepeatable } from "./policy.js";
import { readStdin } from "./stdin.js";

/**
 * Authoring helpers shared by `templates create` and `templates update`. The
 * contract's `params` is an array of objects, which no generated flag can
 * carry, so a parameter is written as one `--param name:type[:null]` per
 * placeholder, in placeholder order. The SQL itself is checked by the API
 * (`querytemplate.Compile`), which names the problem; nothing here repeats it.
 */

/**
 * The declared parameter types, matching the SDK type. `satisfies` keeps this
 * honest: a value here that leaves the contract's enum stops compiling.
 */
const queryTemplateParamTypes = {
  text: "text",
  integer: "integer",
  bigint: "bigint",
  "double precision": "double precision",
  numeric: "numeric",
  boolean: "boolean",
  uuid: "uuid",
  date: "date",
  timestamptz: "timestamptz",
  jsonb: "jsonb",
} satisfies Record<string, QueryTemplateParamTypeKey>;

const PARAM_USAGE = "expected name:type or name:type:null (e.g. customer_id:bigint)";

/**
 * Parse one `--param name:type[:null]` value. The type is checked against the
 * contract's enum here so a typo fails before any request; the name's shape is
 * left to the API, whose message is the authoritative one.
 */
function parseParamFlag(value: string): QueryTemplateParam {
  const parts = value.split(":").map((p) => p.trim());
  if (parts.length < 2 || parts.length > 3 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid --param "${value}": ${PARAM_USAGE}.`);
  }
  const [name, type, modifier] = parts;
  if (modifier !== undefined && modifier !== "null") {
    throw new Error(`Invalid --param "${value}": the third part may only be "null".`);
  }
  const param: QueryTemplateParam = {
    name,
    type: parseEnum(type, queryTemplateParamTypes, `--param type for "${name}"`),
  };
  if (modifier === "null") param.nullable = true;
  return param;
}

/**
 * Collect every `--param` in the order given, which is placeholder order. Not
 * comma-split per value beyond what `collectRepeatable` does, since no part of
 * a parameter spec contains a comma.
 */
export function collectParams(
  rawArgs: readonly string[] | undefined,
  parsed: string | boolean | string[] | undefined,
): QueryTemplateParam[] {
  return collectRepeatable("param", rawArgs, parsed).map(parseParamFlag);
}

/**
 * Resolve the statement from `--sql` or `--sql-file` (`-` reads stdin).
 * Returns undefined when neither is given, so `update` can keep the stored SQL.
 */
export async function resolveSql(
  sql: string | boolean | undefined,
  sqlFile: string | boolean | undefined,
): Promise<string | undefined> {
  const inline = optionalArg(sql);
  const path = optionalArg(sqlFile);
  if (inline !== undefined && path !== undefined) {
    throw new Error("Use either --sql or --sql-file, not both");
  }
  if (path === undefined) return inline;
  let text: string;
  if (path === "-") {
    text = await readStdin();
  } else {
    try {
      text = readFileSync(path, "utf8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Could not read --sql-file ${path}: ${message}`);
    }
  }
  if (text.trim() === "") {
    throw new Error(`--sql-file ${path} is empty`);
  }
  return text;
}

/** One line per parameter, for the human output of create and update. */
export function describeParams(params: readonly QueryTemplateParam[]): string {
  if (params.length === 0) return "none";
  return params
    .map((p, i) => `$${i + 1} ${p.name} ${p.type}${p.nullable ? " (nullable)" : ""}`)
    .join(", ");
}
