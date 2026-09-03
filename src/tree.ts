import type { CommandDef } from "citty";

type SubCommands = NonNullable<CommandDef["subCommands"]>;

/**
 * The top-level command tree. Kept as a standalone module (rather than inline in
 * index.ts) so tests can import and walk it without triggering runMain. Every
 * contract-backed command must be reachable from here; `tree.test.ts` asserts
 * that the full set of generated commands in the manifest resolves through this
 * tree, so a newly generated command that is never registered fails CI instead
 * of silently falling through to top-level help.
 */
export const subCommands: SubCommands = {
  auth: () => import("./commands/auth/index.js").then((m) => m.default),
  whoami: () => import("./commands/whoami.js").then((m) => m.default),
  projects: () => import("./commands/projects/index.js").then((m) => m.default),
  // Top-level aliases for `projects link`/`projects unlink`. Error hints and
  // docs say `pgbeam link`, so the short form must resolve.
  link: () => import("./commands/link.js").then((m) => m.default),
  unlink: () => import("./commands/unlink.js").then((m) => m.default),
  db: () => import("./commands/db/index.js").then((m) => m.default),
  domains: () => import("./commands/domains/index.js").then((m) => m.default),
  replicas: () => import("./commands/replicas/index.js").then((m) => m.default),
  "cache-rules": () => import("./commands/cache-rules/index.js").then((m) => m.default),
  env: () => import("./commands/env/index.js").then((m) => m.default),
  agents: () => import("./commands/agents/index.js").then((m) => m.default),
  policies: () => import("./commands/policies/index.js").then((m) => m.default),
  annotations: () => import("./commands/annotations/index.js").then((m) => m.default),
  audit: () => import("./commands/audit/index.js").then((m) => m.default),
  approvals: () => import("./commands/approvals/index.js").then((m) => m.default),
  anomalies: () => import("./commands/anomalies/index.js").then((m) => m.default),
  honeytokens: () => import("./commands/honeytokens/index.js").then((m) => m.default),
  webhooks: () => import("./commands/webhooks/index.js").then((m) => m.default),
  branches: () => import("./commands/branches/index.js").then((m) => m.default),
  migrations: () => import("./commands/migrations/index.js").then((m) => m.default),
  orgs: () => import("./commands/orgs/index.js").then((m) => m.default),
  analytics: () => import("./commands/analytics/index.js").then((m) => m.default),
  account: () => import("./commands/account/index.js").then((m) => m.default),
  api: () => import("./commands/api/index.js").then((m) => m.default),
  platform: () => import("./commands/platform/index.js").then((m) => m.default),
  mcp: () => import("./commands/mcp.js").then((m) => m.default),
  doctor: () => import("./commands/doctor.js").then((m) => m.default),
  update: () => import("./commands/update.js").then((m) => m.default),
};
