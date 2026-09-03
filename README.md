# @pgbeam/cli

The command line interface for [PgBeam](https://pgbeam.com), a multi-tenant PostgreSQL proxy platform for safe database access by AI agents.

PgBeam sits in the Postgres wire protocol between an agent and your database. It issues scoped agent credentials, enforces a policy on every statement (read-only, table and column allowlists, PII masking, query budgets, kill switch), and records a full audit trail. It also serves a hosted MCP endpoint, pools connections, and caches queries. This CLI drives all of that from the terminal, against the same API the dashboard uses.

Using PgBeam needs an account. The CLI on its own does not talk to your database; it talks to the PgBeam control plane at `api.pgbeam.com`.

## Install

npm, for a Node install (Node 20.19 or newer):

```bash
npm install -g @pgbeam/cli
```

Or run it without installing:

```bash
npx @pgbeam/cli --help
```

Homebrew, for a self-contained native binary with no Node runtime needed:

```bash
brew install sferarc/pgbeam/pgbeam
```

Or the install script, which downloads the same native binary:

```bash
curl -fsSL https://pgbeam.com/install | sh
```

Verify:

```bash
pgbeam --version
```

## Authenticate

```bash
pgbeam auth login
```

Login takes an API key, which you generate in the dashboard under Settings, API Keys. The key is checked against the API before it is stored, and credentials live in a local profile under `~/.config/pgbeam/`. `--profile <name>` keeps several of them side by side.

Non-interactive callers can skip the profile entirely and set `PGBEAM_API_KEY` in the environment, which is the same variable the Terraform, Crossplane, and Pulumi providers read.

## What it can do

```bash
pgbeam --help              # the full tree
pgbeam <command> --help    # a command, its flags, and worked examples
```

Every command takes `--json` for machine-readable output.

**Projects and databases**

- `pgbeam projects` create, list, inspect, update projects, and see per-project usage
- `pgbeam link` / `pgbeam unlink` pin the current directory to a project, so later commands need no `--project`
- `pgbeam db` connect a database to a project and update its connection settings
- `pgbeam replicas` manage read replicas
- `pgbeam domains` manage custom proxy domains
- `pgbeam cache-rules` set query cache rules
- `pgbeam branches` list and discard ephemeral database sandbox branches
- `pgbeam env pull` write a project's connection details into a `.env` file

**Agents, policy, and audit**

- `pgbeam agents` create, inspect, rotate, enable, disable, and revoke scoped agent credentials, read their usage, and emit an MCP client config
- `pgbeam policies` create and update policy profiles, lint them, dry-evaluate a statement against one, and replay past traffic through a candidate policy
- `pgbeam annotations` describe tables and columns so connected agents know what they are looking at
- `pgbeam audit` list, inspect, and export the statement audit log, including per-session views
- `pgbeam approvals` list, approve, and reject statements held for human review
- `pgbeam anomalies` list, acknowledge, and resolve anomaly alerts
- `pgbeam honeytokens` manage decoy relations
- `pgbeam webhooks` manage event and audit webhook endpoints
- `pgbeam migrations lint` flag unsafe DDL before you run it

**Account and platform**

- `pgbeam auth` log in and out, list and switch profiles, show status
- `pgbeam whoami` show the credential in effect and where it came from
- `pgbeam orgs` list and switch organizations, show the plan and usage
- `pgbeam analytics` metrics, insights, plans, and spend limits
- `pgbeam account export` export everything the account holds
- `pgbeam platform` proxy regions and health
- `pgbeam api` call any API route directly, and list or inspect the routes
- `pgbeam mcp` run an MCP server over stdio, exposing the CLI's own surface to an agent
- `pgbeam doctor` diagnose an installation end to end
- `pgbeam update` update a native binary install in place

## Configuration

| Variable                 | Effect                                         |
| ------------------------ | ---------------------------------------------- |
| `PGBEAM_API_KEY`         | API key to use, instead of a stored profile    |
| `PGBEAM_PROFILE`         | Named profile to use                           |
| `PGBEAM_API_URL`         | API base URL, default `https://api.pgbeam.com` |
| `PGBEAM_NO_UPDATE_CHECK` | Suppress the background check for a newer CLI  |
| `NO_COLOR`               | Disable colored output, same as `--no-color`   |

## Documentation

Full command reference at [pgbeam.com/docs/cli](https://pgbeam.com/docs/cli).

## Contributing

This repository is a read-only mirror of a directory in PgBeam's monorepo, kept in sync automatically. Pull requests opened here are synced back, so they are welcome; expect the merge to land through that sync rather than directly.

## License

Apache-2.0
