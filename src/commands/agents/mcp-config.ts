import { readFile, writeFile } from "node:fs/promises";
import { defineCommand } from "citty";
import { consola } from "consola";
import { optionalArg } from "../../lib/args.js";
import { runCommand } from "../../lib/errors.js";
import { globalArgs } from "../../lib/flags.js";
import {
  buildMcpConfigBlocks,
  claudeMcpAddCommand,
  globalPathHint,
  type McpClient,
  parseMcpClient,
} from "../../lib/mcp-config.js";
import { outputJson } from "../../lib/output.js";

/** Read all of stdin as a string (used by --from-json). */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Pull mcp_url + mcp_token out of an `agents create`/`rotate` JSON secrets blob. */
function parseSecretsJson(raw: string): { url: string; token: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Could not parse secrets JSON. Expected `agents create --json` output.");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Secrets JSON must be an object with mcp_url and mcp_token.");
  }
  const obj = parsed as Record<string, unknown>;
  const url = obj.mcp_url;
  const token = obj.mcp_token;
  if (typeof url !== "string" || typeof token !== "string") {
    throw new Error("Secrets JSON is missing string `mcp_url` and/or `mcp_token`.");
  }
  return { url, token };
}

export default defineCommand({
  meta: {
    name: "mcp-config",
    description: "Emit ready-to-paste MCP client config from a credential's secrets",
    docs: {
      longDescription:
        "Render the per-client MCP configuration (Claude Code, Claude Desktop, Cursor, VS Code, Cline, Windsurf) for the hosted agent-database MCP endpoint, given a credential's MCP URL and token. Because secrets are shown only once at creation, pass the URL + token directly (--url/--mcp-token), pipe the JSON output of `agents create --json` / `agents rotate --json` with --from-json, or read it from a saved file with --from-file. Claude Desktop, Cline and Windsurf each keep one config file per machine rather than one per project, so --write prints those with their per-OS path instead of overwriting them: merge the entry in by hand. Claude Desktop also cannot address a remote URL directly, so its config is an `mcp-remote` bridge.",
      examples: [
        {
          comment: "Emit Claude Code config from a URL + token",
          command:
            "pgbeam agents mcp-config --url https://abc.proxy.pgbeam.app/mcp --mcp-token pba_xxx",
        },
        {
          comment: "Emit config for all clients",
          command:
            "pgbeam agents mcp-config --url https://abc.proxy.pgbeam.app/mcp --mcp-token pba_xxx --client all",
        },
        {
          comment: "Emit the Claude Desktop bridge config",
          command:
            "pgbeam agents mcp-config --url https://abc.proxy.pgbeam.app/mcp --mcp-token pba_xxx --client claude-desktop",
        },
        {
          comment: "Pipe from create and write Cursor config to its file",
          command:
            "pgbeam agents create --name ci --policy pol_xxx --json | pgbeam agents mcp-config --from-json --write --client cursor",
        },
      ],
      response:
        "Prints the MCP config block(s). With --json, returns a structured array of { client, file, config }. With --write, writes each project-scoped client's config to its conventional file path; machine-wide files (Claude Desktop, Cline, Windsurf) are printed with their per-OS location instead of being overwritten.",
    },
  },
  args: {
    ...globalArgs,
    url: {
      type: "string",
      description: "Hosted MCP URL (the mcp_url from create/rotate)",
    },
    "mcp-token": {
      type: "string",
      description: "Bearer token for the MCP endpoint (the mcp_token from create/rotate)",
    },
    "from-json": {
      type: "boolean",
      description: "Read mcp_url + mcp_token from an `agents create --json` blob piped on stdin.",
      default: false,
    },
    "from-file": {
      type: "string",
      description:
        "Read mcp_url + mcp_token from an `agents create --json` blob saved to this file.",
    },
    client: {
      type: "string",
      description:
        "MCP client: claude (default), claude-desktop, cursor, vscode, cline, windsurf, or all",
      default: "claude",
    },
    write: {
      type: "boolean",
      description: "Write each client's config to its conventional file path instead of stdout",
      default: false,
    },
  },
  async run({ args }) {
    await runCommand(async () => {
      const client: McpClient | undefined =
        args.client === "all" ? undefined : parseMcpClient(args.client);

      let url: string;
      let token: string;

      const fromFile = optionalArg(args["from-file"]);
      if (fromFile) {
        const secrets = parseSecretsJson(await readFile(fromFile, "utf8"));
        url = secrets.url;
        token = secrets.token;
      } else if (args["from-json"]) {
        const secrets = parseSecretsJson(await readStdin());
        url = secrets.url;
        token = secrets.token;
      } else {
        const flagUrl = optionalArg(args.url);
        const flagToken = optionalArg(args["mcp-token"]);
        if (!flagUrl || !flagToken) {
          throw new Error(
            "Missing credential input: provide --url plus --mcp-token, or pipe an " +
              "`agents create --json` blob with --from-json, or read one from a file with --from-file.",
          );
        }
        url = flagUrl;
        token = flagToken;
      }

      const blocks = buildMcpConfigBlocks(url, token, client);

      if (args.write) {
        for (const block of blocks) {
          if (block.scope === "global") {
            consola.warn(globalPathHint(block));
            consola.box({ title: `${block.label} — ${block.file}`, message: block.config });
            continue;
          }
          await writeFile(block.file, `${block.config}\n`, "utf8");
          consola.success(`Wrote ${block.label} config to ${block.file}`);
        }
        return;
      }

      if (args.json) {
        outputJson(blocks.map((b) => ({ client: b.client, file: b.file, config: b.config })));
        return;
      }

      for (const block of blocks) {
        consola.box({ title: `${block.label} — add to ${block.file}`, message: block.config });
        if (block.scope === "global") {
          consola.info(globalPathHint(block));
        }
      }
      consola.info(`Or, with the Claude Code CLI:\n  ${claudeMcpAddCommand(url, token)}`);
    });
  },
});
