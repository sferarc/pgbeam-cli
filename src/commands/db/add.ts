import { input, password, select } from "@inquirer/prompts";
import { defineCommand } from "citty";
import { consola } from "consola";
import type { CacheConfig, CreateDatabaseBody, PoolConfig } from "pgbeam";
import { parseEnum, parseNumber, poolModes, sslModes } from "../../lib/args.js";
import { requireProject, resolveContext } from "../../lib/client.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";
import { output } from "../../lib/output.js";

const databaseRoles = { primary: "primary", replica: "replica" } as const;

export default defineCommand({
  meta: {
    name: "add",
    description: "Add a database connection",
    docs: {
      longDescription:
        "Add a new database connection to the linked project. PgBeam will use these credentials to connect to your upstream PostgreSQL server. Without the required flags, the command runs interactively and prompts for host, name, username, password, and SSL mode. Advanced flags (role, pool region, query timeout, read routing, and cache/pool config) are optional and default to the platform defaults. After adding, use `pgbeam db test` to verify connectivity.",
      examples: [
        { comment: "Interactive database setup", command: "pgbeam db add" },
        {
          comment: "Add with all connection flags",
          command:
            "pgbeam db add --host db.example.com --port 5432 --name mydb --username admin --password secret --ssl-mode require",
        },
        {
          comment: "Add a read replica near its region with auto read routing",
          command:
            "pgbeam db add --host replica.example.com --name mydb --username admin --password secret --role replica --pool-region us-east-1 --auto-read-routing",
        },
        {
          comment: "Add with a query timeout and caching enabled",
          command:
            "pgbeam db add --host db.example.com --name mydb --username admin --password secret --query-timeout-ms 30000 --cache-enabled --cache-ttl 60",
        },
        {
          comment: "Add and get result as JSON",
          command:
            "pgbeam db add --host db.example.com --name mydb --username admin --password secret --json",
        },
      ],
      response:
        "Prints the new database ID, name, and host:port. Suggests running `pgbeam db test <id>` to verify the connection. With `--json`, returns the full database object.",
    },
  },
  args: {
    ...globalArgs,
    host: {
      type: "string",
      description: "Hostname or IP address of the PostgreSQL server",
    },
    port: {
      type: "string",
      description: "Port number of the PostgreSQL server",
      default: "5432",
    },
    name: {
      type: "string",
      description: "Name of the database on the server",
    },
    username: {
      type: "string",
      description: "Username for authenticating with the database",
    },
    password: {
      type: "string",
      description: "Password for authenticating with the database",
    },
    "ssl-mode": {
      type: "string",
      description: "SSL connection mode: disable, require, verify-ca, or verify-full",
    },
    role: {
      type: "string",
      description: "Database role: primary (receives writes) or replica (receives reads)",
    },
    "pool-region": {
      type: "string",
      description:
        "Region where the connection pool is maintained (near the database). Empty means direct connection.",
    },
    "query-timeout-ms": {
      type: "string",
      description: "Query timeout in milliseconds. 0 means disabled (default).",
    },
    "auto-read-routing": {
      type: "boolean",
      description: "Auto-route SELECT queries to read replicas",
    },
    "cache-enabled": {
      type: "boolean",
      description: "Enable query result caching for this database",
    },
    "cache-ttl": {
      type: "string",
      description: "Time-to-live for cached query results, in seconds",
    },
    "pool-mode": {
      type: "string",
      description: "Connection pool mode: transaction, session, or statement",
    },
    "pool-size": {
      type: "string",
      description: "Maximum number of connections in the pool",
    },
    "min-pool-size": {
      type: "string",
      description: "Minimum number of idle connections maintained in the pool",
    },
  },
  async run({ args }) {
    await runCommand(async () => {
      const ctx = resolveContext(args);
      const projectId = requireProject(ctx);

      const host = args.host ?? (await input({ message: "Database host:" }));
      const port = parseNumber(args.port, "port");
      const name = args.name ?? (await input({ message: "Database name:" }));
      const username = args.username ?? (await input({ message: "Database username:" }));
      const dbPassword =
        args.password ??
        (await password({
          message: "Database password:",
          mask: "*",
        }));
      const sslMode = args["ssl-mode"]
        ? parseEnum(args["ssl-mode"], sslModes, "ssl-mode")
        : await select({
            message: "SSL mode:",
            choices: [
              { name: "require", value: sslModes.require },
              { name: "verify-full", value: sslModes["verify-full"] },
              { name: "verify-ca", value: sslModes["verify-ca"] },
              { name: "disable", value: sslModes.disable },
            ],
          });

      const body: CreateDatabaseBody = {
        host,
        port,
        name,
        username,
        password: dbPassword,
        ssl_mode: sslMode,
      };
      if (args.role) body.role = parseEnum(args.role, databaseRoles, "role");
      if (typeof args["pool-region"] === "string") body.pool_region = args["pool-region"];
      if (args["query-timeout-ms"]) {
        body.query_timeout_ms = parseNumber(args["query-timeout-ms"], "query-timeout-ms");
      }
      if (args["auto-read-routing"] !== undefined) {
        body.auto_read_routing = args["auto-read-routing"];
      }
      if (args["cache-enabled"] !== undefined || args["cache-ttl"]) {
        const cache: Partial<CacheConfig> = {};
        if (args["cache-enabled"] !== undefined) cache.enabled = args["cache-enabled"];
        if (args["cache-ttl"]) cache.ttl_seconds = parseNumber(args["cache-ttl"], "cache-ttl");
        // biome-ignore lint/suspicious/noExplicitAny: server fills the remaining cache defaults
        body.cache_config = cache as any;
      }
      if (args["pool-mode"] || args["pool-size"] || args["min-pool-size"]) {
        const pool: Partial<PoolConfig> = {};
        if (args["pool-mode"])
          pool.pool_mode = parseEnum(args["pool-mode"], poolModes, "pool-mode");
        if (args["pool-size"]) pool.pool_size = parseNumber(args["pool-size"], "pool-size");
        if (args["min-pool-size"]) {
          pool.min_pool_size = parseNumber(args["min-pool-size"], "min-pool-size");
        }
        // biome-ignore lint/suspicious/noExplicitAny: server fills the remaining pool defaults
        body.pool_config = pool as any;
      }

      const result = await ctx.client.databases.createDatabase({
        pathParams: { project_id: projectId },
        body,
      });

      output(result, args.json, () => {
        consola.success(`Database added: ${result.id}`);
        consola.log(`  Name: ${result.name}`);
        consola.log(`  Host: ${result.host}:${result.port}`);
        consola.info(`Verify: pgbeam db test ${result.id}`);
      });
    });
  },
});
