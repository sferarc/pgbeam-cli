import { defineCommand } from "citty";
import { consola } from "consola";
import { type ApiClient, PgBeamClient } from "pgbeam";
import { optionalArg } from "../lib/args.js";
import { apiBaseUrl, resolveAuthState } from "../lib/client.js";
import { VERSION } from "../lib/constants.js";
import { type GlobalArgs, globalArgs } from "../lib/flags.js";
import { probeMcp, probeTcp } from "../lib/net.js";
import { errorStatus, fetchOrganizations, type OrganizationSummary } from "../lib/orgs.js";
import { outputJson } from "../lib/output.js";
import { loadProjectLink } from "../lib/project.js";
import { maskKey } from "./auth/status.js";

/** Postgres port the hosted proxy listens on for agent sessions. */
const PROXY_PG_PORT = 5432;

/** The agent-database tools the hosted MCP endpoint is expected to expose. */
const EXPECTED_MCP_TOOLS = [
  "briefing",
  "query",
  "validate_sql",
  "list_tables",
  "describe_table",
  "explain",
  "schema_catalog",
  "my_permissions",
] as const;

const SOURCE_LABELS: Record<string, string> = {
  flag: "--token flag",
  "profile-flag": "--profile flag",
  env: "PGBEAM_API_KEY env",
  "env-profile": "PGBEAM_PROFILE env",
  profile: "saved profile",
};

type CheckStatus = "pass" | "warn" | "fail" | "skip";

interface CheckResult {
  /** Stable machine-readable id (used in --json output). */
  id: string;
  /** Human-readable check title. */
  title: string;
  status: CheckStatus;
  /** One-line description of what was found. Never contains secrets. */
  detail: string;
  /** One-line remedy shown for warn/fail results. */
  remedy?: string;
}

function ok(id: string, title: string, detail: string): CheckResult {
  return { id, title, status: "pass", detail };
}
function warn(id: string, title: string, detail: string, remedy: string): CheckResult {
  return { id, title, status: "warn", detail, remedy };
}
function fail(id: string, title: string, detail: string, remedy: string): CheckResult {
  return { id, title, status: "fail", detail, remedy };
}
function skip(id: string, title: string, detail: string): CheckResult {
  return { id, title, status: "skip", detail };
}

/** Cross-check state threaded through the diagnostic run. */
interface DoctorState {
  token: string | null;
  client: ApiClient | null;
  orgId: string | null;
  projectId: string | null;
  orgs: OrganizationSummary[] | null;
  proxyHost: string | null;
  defaultPolicyId: string | null;
  projectResolved: boolean;
}

/** Injectable dependencies so the whole run can be exercised offline in tests. */
export interface DoctorDeps {
  makeClient: (token: string | null) => ApiClient;
  fetchOrganizations: typeof fetchOrganizations;
  probeTcp: typeof probeTcp;
  probeMcp: typeof probeMcp;
  baseUrl: string;
}

function defaultDeps(): DoctorDeps {
  return {
    makeClient: (token) => new PgBeamClient({ token, baseUrl: apiBaseUrl() }).api,
    fetchOrganizations,
    probeTcp,
    probeMcp,
    baseUrl: apiBaseUrl(),
  };
}

function classifyApiError(err: unknown): { status: number | null; message: string } {
  const status = errorStatus(err);
  const message = err instanceof Error ? err.message : String(err);
  return { status, message };
}

async function checkCredentials(state: DoctorState, auth: ReturnType<typeof resolveAuthState>) {
  if (!state.token) {
    return fail(
      "credentials",
      "Credentials",
      "No API credential found.",
      `Run \`pgbeam auth login\`, or set PGBEAM_API_KEY / pass --token. Create a key at https://dash.pgbeam.com/settings/account/api-keys.`,
    );
  }
  const source = SOURCE_LABELS[auth.source] ?? auth.source;
  return ok("credentials", "Credentials", `${source}, key ${maskKey(state.token)}.`);
}

async function checkApiReachable(state: DoctorState, deps: DoctorDeps): Promise<CheckResult> {
  const client = state.client ?? deps.makeClient(null);
  try {
    const health = await client.platform.getHealth();
    return ok("api", "Control-plane API", `Reachable at ${deps.baseUrl} (${health.status}).`);
  } catch (err) {
    const { message } = classifyApiError(err);
    return warn(
      "api",
      "Control-plane API",
      `Could not reach ${deps.baseUrl}: ${message}.`,
      "Check your network connection, or PGBEAM_API_URL if you set it. The API may be down.",
    );
  }
}

async function checkTokenValid(state: DoctorState, deps: DoctorDeps): Promise<CheckResult> {
  if (!state.token) {
    return skip("token", "Token validity", "No credential to verify.");
  }
  try {
    state.orgs = await deps.fetchOrganizations(state.token);
    const n = state.orgs.length;
    return ok(
      "token",
      "Token validity",
      `Accepted by the API. ${n} organization${n === 1 ? "" : "s"} visible.`,
    );
  } catch (err) {
    const { status, message } = classifyApiError(err);
    if (status === 401 || status === 403) {
      return fail(
        "token",
        "Token validity",
        `Rejected by the API (${status}).`,
        "The credential is invalid or expired. Run `pgbeam auth login` to re-authenticate.",
      );
    }
    return warn(
      "token",
      "Token validity",
      `Could not verify the token: ${message}.`,
      "The API was unreachable. Re-run once connectivity is restored.",
    );
  }
}

function checkOrganization(state: DoctorState): CheckResult {
  if (!state.orgId) {
    return warn(
      "org",
      "Organization",
      "No organization selected.",
      "Run `pgbeam orgs switch` to pick one, or pass --org.",
    );
  }
  if (state.orgs) {
    const match = state.orgs.find((o) => o.id === state.orgId);
    if (match) {
      return ok("org", "Organization", `${match.name} (${match.id}).`);
    }
    return warn(
      "org",
      "Organization",
      `Selected org ${state.orgId} is not visible to this credential.`,
      "Check the active profile / --org, or that the token has access to this organization.",
    );
  }
  return skip("org", "Organization", `${state.orgId} (not verified, API unreachable).`);
}

async function checkProject(state: DoctorState): Promise<CheckResult> {
  if (!state.projectId) {
    return warn(
      "project",
      "Project",
      "No project linked or selected.",
      "Run `pgbeam link` in your project directory, or pass --project.",
    );
  }
  if (!state.client) {
    return skip("project", "Project", `${state.projectId} (cannot resolve without credentials).`);
  }
  try {
    const project = await state.client.projects.getProject({
      pathParams: { project_id: state.projectId },
    });
    state.projectResolved = true;
    state.proxyHost = project.proxy_host ?? null;
    state.defaultPolicyId = project.default_policy_profile_id ?? null;
    if (project.status !== "active") {
      return warn(
        "project",
        "Project",
        `${project.name} (${project.id}) is ${project.status}.`,
        "The project is not active. Check its status in the dashboard.",
      );
    }
    return ok("project", "Project", `${project.name} (${project.id}), status ${project.status}.`);
  } catch (err) {
    const { status, message } = classifyApiError(err);
    if (status === 404) {
      return fail(
        "project",
        "Project",
        `Project ${state.projectId} was not found.`,
        "Check the project ID, re-run `pgbeam link`, or pass a valid --project.",
      );
    }
    if (status === 401 || status === 403) {
      return fail(
        "project",
        "Project",
        `Access to ${state.projectId} was denied (${status}).`,
        "The credential cannot access this project. Check the profile / organization.",
      );
    }
    return warn(
      "project",
      "Project",
      `Could not load project ${state.projectId}: ${message}.`,
      "The API was unreachable. Re-run once connectivity is restored.",
    );
  }
}

async function checkDatabases(state: DoctorState): Promise<CheckResult> {
  if (!state.client || !state.projectId) {
    return skip("databases", "Databases", "Skipped (no resolvable project).");
  }
  try {
    const result = await state.client.databases.listDatabases({
      pathParams: { project_id: state.projectId },
    });
    const dbs = result.databases;
    if (dbs.length === 0) {
      return warn(
        "databases",
        "Databases",
        "No databases registered for this project.",
        "Add an upstream database with `pgbeam db add`.",
      );
    }
    const first = dbs[0];
    const extra = dbs.length > 1 ? ` (+${dbs.length - 1} more)` : "";
    return ok(
      "databases",
      "Databases",
      `${dbs.length} registered. Primary: ${first.host}:${first.port} ssl=${first.ssl_mode}${extra}.`,
    );
  } catch (err) {
    const { message } = classifyApiError(err);
    return warn(
      "databases",
      "Databases",
      `Could not list databases: ${message}.`,
      "The API was unreachable. Re-run once connectivity is restored.",
    );
  }
}

async function checkProxy(state: DoctorState, deps: DoctorDeps): Promise<CheckResult> {
  if (!state.proxyHost) {
    return skip(
      "proxy",
      "Proxy reachability",
      "Skipped (proxy host unknown until the project resolves).",
    );
  }
  const probe = await deps.probeTcp(state.proxyHost, PROXY_PG_PORT);
  if (probe.ok) {
    return ok(
      "proxy",
      "Proxy reachability",
      `TCP ${state.proxyHost}:${PROXY_PG_PORT} reachable (${probe.ms}ms).`,
    );
  }
  return warn(
    "proxy",
    "Proxy reachability",
    `Could not reach ${state.proxyHost}:${PROXY_PG_PORT}: ${probe.error ?? "unknown error"}.`,
    "Best-effort check. Egress may be blocked from here; verify from your application network.",
  );
}

async function checkMcp(
  state: DoctorState,
  deps: DoctorDeps,
  mcpUrlArg: string | undefined,
  mcpToken: string | null,
): Promise<CheckResult> {
  const url = mcpUrlArg ?? (state.proxyHost ? `https://${state.proxyHost}/mcp` : null);
  if (!url) {
    return skip(
      "mcp",
      "MCP endpoint",
      "Skipped (MCP URL unknown until the project resolves; pass --mcp-url to check directly).",
    );
  }
  const probe = await deps.probeMcp(url, mcpToken);
  if (!probe.reachable) {
    return warn(
      "mcp",
      "MCP endpoint",
      `Could not reach ${url}: ${probe.error ?? "unknown error"}.`,
      "Best-effort check. Verify the proxy host and that HTTPS egress is allowed from here.",
    );
  }
  if (!probe.tools) {
    const hint = mcpToken
      ? ""
      : " Pass --mcp-token (or set PGBEAM_MCP_TOKEN) to verify the tool set.";
    return ok("mcp", "MCP endpoint", `Reachable at ${url} (HTTP ${probe.status ?? "?"}).${hint}`);
  }
  const missing = EXPECTED_MCP_TOOLS.filter((t) => !probe.tools?.includes(t));
  if (missing.length > 0) {
    return warn(
      "mcp",
      "MCP endpoint",
      `Reachable, but missing expected tools: ${missing.join(", ")}.`,
      "The endpoint may be misconfigured or on an older proxy. Contact support if this persists.",
    );
  }
  return ok(
    "mcp",
    "MCP endpoint",
    `Reachable at ${url}. ${probe.tools.length} tools, all expected present.`,
  );
}

async function checkPolicy(state: DoctorState): Promise<CheckResult> {
  if (!state.client || !state.projectResolved) {
    return skip("policy", "Active policy", "Skipped (no resolvable project).");
  }
  if (!state.defaultPolicyId) {
    return warn(
      "policy",
      "Active policy",
      "No default policy profile is set for this project.",
      "Agents fall back to their own policy. Set a default with `pgbeam projects update`, or attach a policy per agent.",
    );
  }
  try {
    const policy = await state.client.policies.getPolicyProfile({
      pathParams: {
        project_id: state.projectId as string,
        policy_id: state.defaultPolicyId,
      },
    });
    const parts = [`access ${policy.access_mode}`];
    if (policy.table_allowlist.length > 0)
      parts.push(`${policy.table_allowlist.length} allowed table(s)`);
    if (policy.table_denylist.length > 0)
      parts.push(`${policy.table_denylist.length} denied table(s)`);
    if (policy.masking_rules.length > 0)
      parts.push(`${policy.masking_rules.length} masking rule(s)`);
    if (policy.budget_queries_per_hour) parts.push(`${policy.budget_queries_per_hour}/hour budget`);
    return ok("policy", "Active policy", `${policy.name}: ${parts.join(", ")}.`);
  } catch (err) {
    const { message } = classifyApiError(err);
    return warn(
      "policy",
      "Active policy",
      `Could not load the default policy: ${message}.`,
      "The API was unreachable, or the referenced policy is missing.",
    );
  }
}

/**
 * Run every diagnostic check in order, threading shared state so later checks
 * reuse what earlier ones resolved (organization list, proxy host, default
 * policy). Never throws: each check catches its own failures.
 */
export async function runDoctor(args: GlobalArgs, deps: DoctorDeps): Promise<CheckResult[]> {
  let auth: ReturnType<typeof resolveAuthState>;
  try {
    auth = resolveAuthState(args);
  } catch (err) {
    // A missing --profile is the only thing resolveAuthState throws on. Treat it
    // as "no credentials" so the run continues and reports it cleanly.
    const message = err instanceof Error ? err.message : String(err);
    return [
      fail(
        "credentials",
        "Credentials",
        message,
        "Run `pgbeam auth login`, or check the profile name you passed.",
      ),
    ];
  }

  const projectId = args.project ?? loadProjectLink()?.projectId ?? null;
  const state: DoctorState = {
    token: auth.token,
    client: auth.token ? deps.makeClient(auth.token) : null,
    orgId: args.org ?? auth.orgId ?? null,
    projectId,
    orgs: null,
    proxyHost: null,
    defaultPolicyId: null,
    projectResolved: false,
  };

  const looseArgs = args as GlobalArgs & { "mcp-url"?: string; "mcp-token"?: string };
  const mcpUrlArg = optionalArg(looseArgs["mcp-url"]);
  const mcpToken = optionalArg(looseArgs["mcp-token"]) ?? process.env.PGBEAM_MCP_TOKEN ?? null;

  const results: CheckResult[] = [];
  results.push(ok("cli", "CLI", `pgbeam ${VERSION}.`));
  results.push(await checkCredentials(state, auth));
  results.push(await checkApiReachable(state, deps));
  results.push(await checkTokenValid(state, deps));
  results.push(checkOrganization(state));
  results.push(await checkProject(state));
  results.push(await checkDatabases(state));
  results.push(await checkProxy(state, deps));
  results.push(await checkMcp(state, deps, mcpUrlArg, mcpToken));
  results.push(await checkPolicy(state));
  return results;
}

const STATUS_TAG: Record<CheckStatus, string> = {
  pass: "PASS",
  warn: "WARN",
  fail: "FAIL",
  skip: "SKIP",
};

export function renderReport(results: CheckResult[], json: boolean): void {
  const counts = {
    pass: results.filter((r) => r.status === "pass").length,
    warn: results.filter((r) => r.status === "warn").length,
    fail: results.filter((r) => r.status === "fail").length,
    skip: results.filter((r) => r.status === "skip").length,
  };

  if (json) {
    outputJson({
      ok: counts.fail === 0,
      summary: counts,
      checks: results.map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        detail: r.detail,
        ...(r.remedy ? { remedy: r.remedy } : {}),
      })),
    });
    return;
  }

  consola.log("PgBeam doctor\n");
  const width = Math.max(...results.map((r) => r.title.length));
  for (const r of results) {
    consola.log(`  [${STATUS_TAG[r.status]}] ${r.title.padEnd(width)}  ${r.detail}`);
    if (r.remedy && (r.status === "warn" || r.status === "fail")) {
      consola.log(`         ${" ".repeat(width)}  -> ${r.remedy}`);
    }
  }

  consola.log(
    `\n${counts.pass} passed, ${counts.warn} warning(s), ${counts.fail} failed, ${counts.skip} skipped.`,
  );
  if (counts.fail === 0 && counts.warn === 0) {
    consola.success("Everything looks healthy.");
  } else if (counts.fail === 0) {
    consola.info("No blocking problems. Review the warnings above.");
  } else {
    consola.warn("One or more checks failed. Follow the remedies above.");
  }
}

export default defineCommand({
  meta: {
    name: "doctor",
    description: "Diagnose your PgBeam setup end to end",
    icon: "Stethoscope",
    docs: {
      longDescription:
        "Run an end-to-end diagnostic of your PgBeam setup and print actionable pass, warning, and fail results. Doctor checks that credentials are present and valid, the control-plane API is reachable, the selected organization, project, and databases resolve, the proxy Postgres port is reachable (best-effort TCP), the hosted MCP endpoint answers (and, with --mcp-token, exposes the expected agent-database tools), and summarizes the project's default policy. It degrades gracefully offline: network problems are warnings with guidance, not crashes, and it never prints secrets. Exits non-zero only when a check fails.",
      examples: [
        { comment: "Diagnose the linked project", command: "pgbeam doctor" },
        { comment: "Diagnose a specific project", command: "pgbeam doctor --project prj_xxx" },
        {
          comment: "Fully verify the MCP tool set with an agent token",
          command: "pgbeam doctor --mcp-token pba_xxx",
        },
        { comment: "Machine-readable output for CI", command: "pgbeam doctor --json" },
      ],
      response:
        "Prints one line per check with a PASS/WARN/FAIL/SKIP tag, a one-line finding, and a remedy for anything not passing, followed by a summary. With --json, returns { ok, summary, checks }. Exits non-zero when any check fails.",
    },
  },
  args: {
    ...globalArgs,
    "mcp-url": {
      type: "string",
      description: "MCP endpoint URL to check directly (defaults to the project's proxy host).",
    },
    "mcp-token": {
      type: "string",
      description:
        "Agent MCP bearer token (pba_...) used to verify the endpoint's tool set. Also read from PGBEAM_MCP_TOKEN.",
    },
  },
  async run({ args }) {
    const typed = args as GlobalArgs;
    const results = await runDoctor(typed, defaultDeps());
    renderReport(results, typed.json === true);
    if (results.some((r) => r.status === "fail")) {
      process.exitCode = 1;
    }
  },
});
