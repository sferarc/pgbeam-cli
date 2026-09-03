import { input, select } from "@inquirer/prompts";
import { type ArgsDef, type CommandDef, defineCommand } from "citty";
import { consola } from "consola";
import type { ApiClient } from "pgbeam";
import {
  commandManifest,
  type GeneratedColumn,
  type GeneratedCommand,
  type GeneratedFlag,
} from "../generated/manifest.gen.js";
import { optionalArg, parseNumber, requireArg } from "./args.js";
import { requireOrg, requireProject, resolveContext } from "./client.js";
import { confirmDestructive } from "./confirm.js";
import { runCommand } from "./errors.js";
import { type GlobalArgs, globalArgs } from "./flags.js";
import { formatDate, output, outputTable } from "./output.js";

/**
 * Runtime that turns a contract-derived {@link GeneratedCommand} from the
 * manifest into a citty command. One runtime backs every generated API-surface
 * command, so those commands cannot drift from the OpenAPI contract: their
 * flags, path parameters, pagination, and output all come from the manifest,
 * which is regenerated from the spec by `scripts/src/generate-cli.ts`.
 *
 * Bespoke commands (auth, mcp, env, link, interactive creators, secret
 * rendering) stay hand-authored and are composed alongside these generated
 * leaves by the group index files.
 */

/** Loosely typed parsed args from citty (flags are strings or booleans). */
type ParsedArgs = Record<string, string | boolean | undefined>;

/** Extract the typed global args citty parsed for us from the loose bag. */
function globalsFrom(args: ParsedArgs): GlobalArgs {
  return {
    token: optionalArg(args.token),
    profile: optionalArg(args.profile),
    project: optionalArg(args.project),
    org: optionalArg(args.org),
    json: args.json === true,
    "no-color": args["no-color"] === true,
    debug: args.debug === true,
    trunc: args.trunc !== false,
  };
}

interface RequestParams {
  pathParams?: Record<string, string>;
  queryParams?: Record<string, string | number | boolean>;
  body?: Record<string, unknown>;
}

/**
 * Dispatch a request by route string. The route comes from the generated
 * manifest (validated against the contract at generation time) and the params
 * are assembled from typed CLI flags. The SDK's `request()` is fully typed per
 * route; we cross that boundary once here with a widened signature so a single
 * runtime can dispatch every generated route without an `any`.
 */
function callRoute(client: ApiClient, route: string, params: RequestParams): Promise<unknown> {
  const request = client.request as unknown as (
    route: string,
    params: RequestParams,
  ) => Promise<unknown>;
  return request(route, params);
}

const PAGE_TOKEN_KEY = "page_token";
const PAGE_SIZE_KEY = "page_size";
const NEXT_TOKEN_KEY = "next_page_token";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatValue(value: unknown, isDate: boolean): string {
  if (value === null || value === undefined) return "-";
  if (isDate && typeof value === "string") {
    return formatDate(value);
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function toRow(item: unknown, columns: GeneratedColumn[]): Record<string, unknown> {
  const record = isRecord(item) ? item : {};
  const row: Record<string, unknown> = {};
  for (const col of columns) {
    row[col.key] = formatValue(record[col.key], col.date ?? false);
  }
  return row;
}

function tableColumns(columns: GeneratedColumn[]): { key: string; label: string }[] {
  return columns.map((c) => ({ key: c.key, label: c.label }));
}

/** Build the citty args definition for a generated command. */
function buildArgs(spec: GeneratedCommand): ArgsDef {
  const args: ArgsDef = { ...globalArgs };

  if (spec.positionalName) {
    args[spec.positionalName] = {
      type: "positional",
      required: false,
      description: positionalDescription(spec),
    };
  }

  for (const flag of spec.flags) {
    // A flag promoted to the positional argument is defined above, not as an
    // option, so skip it here to avoid a duplicate arg key.
    if (flag.name === spec.positionalName) continue;
    const req = flag.required ? " (required)" : "";
    const allowed = flag.enumValues ? ` One of: ${flag.enumValues.join(", ")}.` : "";
    // Boolean flags are modelled as valued string flags (`--flag true|false`)
    // rather than citty booleans. A bare citty boolean silently drops a trailing
    // `false` (`--flag false` parses as true), so an explicit value is the only
    // safe way to set a body/query boolean to false.
    const boolHint = flag.type === "boolean" ? " Accepts true or false." : "";
    args[flag.name] = {
      type: "string",
      description: `${flag.description}${allowed}${boolHint}${req}`.trim(),
    };
  }

  if (spec.destructive) {
    args.yes = {
      type: "boolean",
      alias: "y",
      description: "Skip the confirmation prompt (useful for scripts and CI/CD)",
      default: false,
    };
  }

  if (spec.paginated) {
    args.limit = { type: "string", description: "Maximum number of items to return (1-100)" };
    args.all = {
      type: "boolean",
      description: "Fetch every page and return the full result set",
      default: false,
    };
    args["page-token"] = { type: "string", description: "Opaque pagination cursor to start from" };
  }

  return args;
}

function positionalDescription(spec: GeneratedCommand): string {
  const pp = spec.pathParams.find(
    (p) => p.source === "positional" || p.source === "project-positional",
  );
  if (pp) {
    if (pp.source === "project-positional") {
      return `${pp.description} Uses the linked project if omitted.`.trim();
    }
    return pp.description || "Resource ID";
  }
  // A body/query flag promoted to the positional argument.
  const flag = spec.flags.find((f) => f.name === spec.positionalName);
  return flag?.description || "Value";
}

function resolvePathParams(
  spec: GeneratedCommand,
  args: ParsedArgs,
  ctx: ReturnType<typeof resolveContext>,
): Record<string, string> {
  const pathParams: Record<string, string> = {};
  const positional = spec.positionalName ? optionalArg(args[spec.positionalName]) : undefined;

  for (const pp of spec.pathParams) {
    switch (pp.source) {
      case "org":
        pathParams[pp.name] = requireOrg(ctx);
        break;
      case "project":
        pathParams[pp.name] = requireProject(ctx);
        break;
      case "project-positional":
        pathParams[pp.name] = positional ?? requireProject(ctx);
        break;
      case "positional":
        pathParams[pp.name] = requireArg(positional, spec.positionalName ?? pp.name);
        break;
    }
  }
  return pathParams;
}

function coerceFlag(
  flag: GeneratedFlag,
  raw: string | boolean | undefined,
): string | number | boolean | string[] | undefined {
  if (raw === undefined) return undefined;
  switch (flag.type) {
    case "boolean": {
      if (typeof raw === "boolean") return raw;
      const value = raw.toLowerCase();
      if (value === "true") return true;
      if (value === "false") return false;
      throw new Error(`Invalid --${flag.name}: expected "true" or "false", got "${raw}".`);
    }
    case "number":
      return parseNumber(String(raw), flag.name);
    case "string[]":
      return String(raw)
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    default: {
      const value = String(raw);
      if (flag.enumValues && !flag.enumValues.includes(value)) {
        throw new Error(
          `Invalid --${flag.name}: "${value}". Allowed: ${flag.enumValues.join(", ")}.`,
        );
      }
      return value;
    }
  }
}

/** Prompt for a required flag whose value is missing, when attached to a TTY. */
async function promptFlag(flag: GeneratedFlag): Promise<string> {
  if (flag.enumValues && flag.enumValues.length > 0) {
    return select({
      message: `${flag.name}:`,
      choices: flag.enumValues.map((v) => ({ name: v, value: v })),
    });
  }
  return input({ message: `${flag.name}:` });
}

async function resolveFlagValue(
  flag: GeneratedFlag,
  args: ParsedArgs,
): Promise<string | number | boolean | string[] | undefined> {
  const coerced = coerceFlag(flag, args[flag.name]);
  if (coerced !== undefined) return coerced;
  if (!flag.required) return undefined;
  if (process.stdin.isTTY) {
    return coerceFlag(flag, await promptFlag(flag));
  }
  throw new Error(`Missing required flag: --${flag.name}`);
}

interface BuiltRequest {
  queryParams: Record<string, string | number | boolean>;
  body: Record<string, unknown>;
  hasBody: boolean;
}

async function buildRequest(
  spec: GeneratedCommand,
  args: ParsedArgs,
  ctx: ReturnType<typeof resolveContext>,
): Promise<BuiltRequest> {
  const queryParams: Record<string, string | number | boolean> = {};
  const body: Record<string, unknown> = {};

  for (const inject of spec.injectedQuery) {
    const value = inject.source === "org" ? requireOrg(ctx) : requireProject(ctx);
    if (inject.into === "body") body[inject.key] = value;
    else queryParams[inject.key] = value;
  }

  for (const flag of spec.flags) {
    const value = await resolveFlagValue(flag, args);
    if (value === undefined) continue;
    if (flag.bodyKey) body[flag.bodyKey] = value;
    else if (flag.queryKey) {
      queryParams[flag.queryKey] = Array.isArray(value) ? value.join(",") : value;
    }
  }

  if (spec.paginated) {
    const limit = optionalArg(args.limit);
    if (limit) queryParams[PAGE_SIZE_KEY] = parseNumber(limit, "limit");
    const token = optionalArg(args["page-token"]);
    if (token) queryParams[PAGE_TOKEN_KEY] = token;
  }

  return { queryParams, body, hasBody: spec.hasBody && Object.keys(body).length > 0 };
}

/**
 * Describe what a destructive command is about to act on when it has no
 * positional id to name. Some resources are addressed by a natural key carried
 * in flags (schema annotations, keyed by schema/table/column), and a bare
 * "Delete a schema annotation?" prompt tells the operator nothing about which
 * one. Rendered from the assembled request, so it shows the values actually
 * being sent.
 */
function describeFlagTarget(spec: GeneratedCommand, request: BuiltRequest): string | undefined {
  const parts: string[] = [];
  for (const flag of spec.flags) {
    const key = flag.bodyKey ?? flag.queryKey;
    if (!key) continue;
    const value = flag.bodyKey ? request.body[key] : request.queryParams[key];
    if (value === undefined) continue;
    parts.push(`${key}=${String(value)}`);
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function renderOutput(spec: GeneratedCommand, result: unknown, json: boolean): void {
  const { output: out } = spec;

  if (out.kind === "message") {
    output(result ?? { ok: true }, json, () => {
      consola.success(`${spec.summary}.`);
    });
    return;
  }

  if (out.kind === "list" && out.listField && out.columns) {
    const listField = out.listField;
    const columns = out.columns;
    output(result, json, () => {
      const record = isRecord(result) ? result : {};
      const items = Array.isArray(record[listField]) ? (record[listField] as unknown[]) : [];
      outputTable(
        items.map((item) => toRow(item, columns)),
        tableColumns(columns),
      );
      const next = record[NEXT_TOKEN_KEY];
      if (typeof next === "string" && next.length > 0) {
        consola.info("More results available. Re-run with --all to fetch every page.");
      }
    });
    return;
  }

  if (out.kind === "detail" && out.columns) {
    const columns = out.columns;
    output(result, json, () => {
      const record = isRecord(result) ? result : {};
      const width = Math.max(...columns.map((c) => c.label.length)) + 1;
      for (const col of columns) {
        consola.log(
          `${`${col.label}:`.padEnd(width + 1)} ${formatValue(record[col.key], col.date ?? false)}`,
        );
      }
    });
    return;
  }

  // Raw fallback: always JSON, even without --json, since there is no clean
  // human projection derivable from the contract.
  output(result, true);
}

async function fetchAllPages(
  client: ApiClient,
  spec: GeneratedCommand,
  pathParams: Record<string, string>,
  queryParams: Record<string, string | number | boolean>,
): Promise<unknown> {
  const listField = spec.output.listField;
  if (!listField) return callRoute(client, spec.route, { pathParams, queryParams });

  const items: unknown[] = [];
  let token: string | undefined;
  let last: Record<string, unknown> = {};
  do {
    const page: Record<string, string | number | boolean> = { ...queryParams };
    if (token) page[PAGE_TOKEN_KEY] = token;
    const result = await callRoute(client, spec.route, { pathParams, queryParams: page });
    last = isRecord(result) ? result : {};
    if (Array.isArray(last[listField])) items.push(...(last[listField] as unknown[]));
    const next = last[NEXT_TOKEN_KEY];
    token = typeof next === "string" && next.length > 0 ? next : undefined;
  } while (token);

  return { ...last, [listField]: items, [NEXT_TOKEN_KEY]: "" };
}

/** Build one citty command from a manifest entry. */
export function buildGeneratedCommand(spec: GeneratedCommand): CommandDef {
  return defineCommand({
    meta: {
      name: spec.command[spec.command.length - 1],
      description: spec.summary,
    },
    args: buildArgs(spec),
    async run({ args }) {
      const parsed = args as ParsedArgs;
      await runCommand(async () => {
        const ctx = resolveContext(globalsFrom(parsed));
        const pathParams = resolvePathParams(spec, parsed, ctx);
        const request = await buildRequest(spec, parsed, ctx);
        const { queryParams, body, hasBody } = request;

        if (spec.destructive) {
          const target = spec.positionalName ? optionalArg(parsed[spec.positionalName]) : undefined;
          // Only a positional id is typed back to confirm. A flag-keyed target
          // is shown, not retyped: it is several values, and the typed check is
          // for the high-stakes id deletes it already guards.
          const shown = target ?? describeFlagTarget(spec, request);
          await confirmDestructive({
            yes: parsed.yes === true,
            action: spec.summary,
            message: `${spec.summary}${shown ? ` (${shown})` : ""}? This cannot be undone.`,
            ...(target ? { requireMatch: target } : {}),
          });
        }

        const wantAll = spec.paginated && parsed.all === true;
        const result = wantAll
          ? await fetchAllPages(ctx.client, spec, pathParams, queryParams)
          : await callRoute(ctx.client, spec.route, {
              pathParams,
              queryParams,
              ...(hasBody ? { body } : {}),
            });

        renderOutput(spec, result, parsed.json === true);
      });
    },
  });
}

function findSpec(command: string[]): GeneratedCommand {
  const spec = commandManifest.find(
    (s) => s.command.length === command.length && s.command.every((seg, i) => command[i] === seg),
  );
  if (!spec) {
    throw new Error(
      `No generated command for "${command.join(" ")}". Map it in COMMAND_MAP in ` +
        `scripts/src/generate-cli.ts and run pnpm generate:cli.`,
    );
  }
  return spec;
}

/**
 * Return a lazy citty subcommand loader for one generated command, identified by
 * its full command path (e.g. ["projects", "domains", "verify"]). Group index
 * files place these alongside their bespoke, hand-authored subcommands, so the
 * generated leaves compose into the existing command tree without drift. The
 * loader is lazy (matching the hand-authored `() => import(...)` pattern), so no
 * command is constructed until it is actually invoked.
 */
export function generatedLeaf(command: string[]): () => Promise<CommandDef> {
  const spec = findSpec(command);
  return () => Promise.resolve(buildGeneratedCommand(spec));
}
