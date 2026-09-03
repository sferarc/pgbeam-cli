import { describe, expect, it, vi } from "vitest";

vi.mock("citty", () => ({
  defineCommand: vi.fn((def: Record<string, unknown>) => def),
}));

// Import after mock is set up
import { defineCommand } from "citty";
import accountCommand from "./account/index.js";
import agentsCommand from "./agents/index.js";
import analyticsCommand from "./analytics/index.js";
import annotationsCommand from "./annotations/index.js";
import anomaliesCommand from "./anomalies/index.js";
import apiCommand from "./api/index.js";
import approvalsCommand from "./approvals/index.js";
import auditCommand from "./audit/index.js";
import authCommand from "./auth/index.js";
import branchesCommand from "./branches/index.js";
import cacheRulesCommand from "./cache-rules/index.js";
import dbCommand from "./db/index.js";
import domainsCommand from "./domains/index.js";
import envCommand from "./env/index.js";
import honeytokensCommand from "./honeytokens/index.js";
import migrationsCommand from "./migrations/index.js";
import orgsCommand from "./orgs/index.js";
import platformCommand from "./platform/index.js";
import policiesCommand from "./policies/index.js";
import projectsCommand from "./projects/index.js";
import replicasCommand from "./replicas/index.js";
import webhooksCommand from "./webhooks/index.js";

const commands: Record<string, Record<string, unknown>> = {
  account: accountCommand,
  agents: agentsCommand,
  analytics: analyticsCommand,
  annotations: annotationsCommand,
  anomalies: anomaliesCommand,
  api: apiCommand,
  approvals: approvalsCommand,
  audit: auditCommand,
  auth: authCommand,
  branches: branchesCommand,
  "cache-rules": cacheRulesCommand,
  db: dbCommand,
  domains: domainsCommand,
  env: envCommand,
  honeytokens: honeytokensCommand,
  migrations: migrationsCommand,
  orgs: orgsCommand,
  platform: platformCommand,
  policies: policiesCommand,
  projects: projectsCommand,
  replicas: replicasCommand,
  webhooks: webhooksCommand,
};

const expectedMeta: Record<string, { name: string; description: string }> = {
  account: { name: "account", description: "Manage account settings" },
  agents: { name: "agents", description: "Manage AI agent credentials" },
  analytics: { name: "analytics", description: "Metrics, insights, and plans" },
  annotations: {
    name: "annotations",
    description: "Describe tables and columns for connected agents",
  },
  anomalies: { name: "anomalies", description: "Review anomaly-detection alerts" },
  api: { name: "api", description: "Interact with the PgBeam API directly" },
  approvals: { name: "approvals", description: "Review and decide held statement approvals" },
  audit: { name: "audit", description: "View agent statement audit logs" },
  auth: { name: "auth", description: "Manage authentication" },
  branches: { name: "branches", description: "Manage ephemeral database sandbox branches" },
  "cache-rules": { name: "cache-rules", description: "Manage cache rules for query caching" },
  db: { name: "db", description: "Manage databases" },
  domains: { name: "domains", description: "Manage custom domains" },
  env: { name: "env", description: "Manage environment variables" },
  honeytokens: { name: "honeytokens", description: "Manage decoy (canary) relations" },
  migrations: { name: "migrations", description: "Lint migrations for unsafe DDL" },
  orgs: { name: "orgs", description: "Manage organizations" },
  platform: { name: "platform", description: "Regions and health checks" },
  policies: { name: "policies", description: "Manage agent policy profiles" },
  projects: { name: "projects", description: "Manage projects" },
  replicas: { name: "replicas", description: "Manage read replicas" },
  webhooks: { name: "webhooks", description: "Manage event/audit webhook endpoints" },
};

const expectedSubCommands: Record<string, string[]> = {
  account: ["export"],
  agents: [
    "list",
    "ls",
    "show",
    "get",
    "inspect",
    "create",
    "mcp-config",
    "rotate",
    "revoke",
    "rm",
    "disable",
    "enable",
    "recommend-policy",
    "right-size",
    "usage",
  ],
  analytics: ["metrics", "insights", "plans", "spend-limit"],
  annotations: ["list", "ls", "set", "delete", "rm"],
  anomalies: ["list", "ls", "ack", "acknowledge", "resolve"],
  api: ["ls", "list", "request", "schema"],
  approvals: ["list", "ls", "approve", "reject"],
  audit: ["list", "ls", "export", "session", "verify"],
  auth: ["login", "logout", "list", "switch", "status", "whoami"],
  branches: ["list", "ls", "discard", "rm"],
  "cache-rules": ["list", "ls", "set"],
  db: [
    "list",
    "ls",
    "add",
    "create",
    "inspect",
    "show",
    "update",
    "delete",
    "rm",
    "test",
    "scan-pii",
    "schema-catalog",
  ],
  domains: ["list", "ls", "add", "create", "verify", "delete", "rm"],
  env: ["pull"],
  honeytokens: ["list", "ls", "create", "add", "show", "inspect", "update", "delete", "rm"],
  migrations: ["lint"],
  orgs: ["list", "ls", "switch", "usage", "plan"],
  platform: ["regions", "health"],
  policies: [
    "list",
    "ls",
    "show",
    "inspect",
    "create",
    "update",
    "dry-eval",
    "lint",
    "replay",
    "delete",
    "rm",
  ],
  projects: [
    "list",
    "ls",
    "create",
    "inspect",
    "show",
    "update",
    "delete",
    "usage",
    "link",
    "unlink",
    "domains",
    "replicas",
    "cache-rules",
    "env",
  ],
  replicas: ["list", "ls", "add", "create", "delete", "rm"],
  webhooks: ["list", "ls", "create", "show", "inspect", "update", "delete", "rm", "test"],
};

describe("command index files", () => {
  it("calls defineCommand for every command module", () => {
    expect(vi.mocked(defineCommand)).toHaveBeenCalledTimes(22);
  });

  for (const [key, command] of Object.entries(commands)) {
    describe(key, () => {
      it("exports a default command definition", () => {
        expect(command).toBeDefined();
        expect(command.meta).toBeDefined();
        expect(command.subCommands).toBeDefined();
      });

      it("has correct meta name and description", () => {
        const meta = command.meta as { name: string; description: string };
        expect(meta.name).toBe(expectedMeta[key].name);
        expect(meta.description).toBe(expectedMeta[key].description);
      });

      it("has all expected subcommands", () => {
        const subCmds = Object.keys(command.subCommands as Record<string, unknown>);
        expect(subCmds).toEqual(expectedSubCommands[key]);
      });

      it("has lazy-loaded subcommands (functions)", () => {
        const subCmds = command.subCommands as Record<string, unknown>;
        for (const loader of Object.values(subCmds)) {
          expect(typeof loader).toBe("function");
        }
      });
    });
  }
});
