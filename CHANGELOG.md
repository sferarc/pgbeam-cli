# @pgbeam/cli

## 0.5.2

### Patch Changes

- 0cf6810: refactor(policy): serve statement-kind verdicts from the engine to the CLI card
- Updated dependencies [0cf6810]
  - pgbeam@0.7.1

## 0.5.1

### Patch Changes

- 796f4a7: Policy profiles carry `query_mode` (`sql` or `templates`). A profile set to `templates` admits only the project's enabled query templates, and every other rule on the profile still applies to what a template runs. Setting `templates` is refused when the project has no enabled template, and while the organization has a live self-hosted enrollment. On update, an omitted `query_mode` keeps the stored mode. In Terraform, Crossplane and Pulumi, removing `query_mode` from a config plans `sql`, and the plan shows that change.
- Updated dependencies [796f4a7]
  - pgbeam@0.7.0

## 0.5.0

### Minor Changes

- 400eade: Remove `sandbox` from `--write-mode` on `pgbeam policies create` and `pgbeam policies update`. Sandbox write mode has been withdrawn; use `rollback` for writes that must never persist.

### Patch Changes

- Updated dependencies [5dbe64b]
- Updated dependencies [b2fdcfd]
- Updated dependencies [21e87a0]
- Updated dependencies [d651ca6]
- Updated dependencies [ca0bb93]
  - pgbeam@0.6.0

## 0.4.0

### Minor Changes

- 143be99: Add `pgbeam templates` to manage a project's query templates: `list`, `show` and `delete`, plus `create` and `update`, which take the statement from `--sql` or `--sql-file` (`-` reads stdin) and one `--param name:type[:null]` per placeholder, in order. A parameter type outside the API's ten is refused before any request. Nothing restricts a credential to templates yet: the policy profile setting that does arrives in a later release.

### Patch Changes

- 5e44855: `pgbeam agents inspect` now reports COPY as blocked in every access mode, matching the proxy, which refuses COPY for agent credentials before any statement rule applies. It previously showed COPY as allowed on a read-write credential.
- 8728717: `pgbeam agents rotate` now asks for confirmation before rotating, since the old password and MCP token stop working within seconds and cannot be restored. Scripts and CI must pass `--yes` (or `-y`); without it, a non-interactive run fails with exit code 1 and leaves the credential untouched.
- d1add28: Write `auth.json` atomically through a temp file and rename, tighten an existing config file to 0600 and its directory to 0700, and move a corrupted `auth.json` aside to `auth.json.corrupt-<timestamp>` instead of overwriting it with an empty config.
- 102e7f0: `auth status`, `whoami` and `doctor` now report the organization commands actually target when the credential comes from `--token` or `PGBEAM_API_KEY`, show where it came from, and warn when it was taken from a stored profile.
- 289e80c: `pgbeam env pull` now recognises `export DATABASE_URL=` and `DATABASE_URL = ` lines and replaces them in place instead of appending a second one, no longer prompts or claims success when the file only has a key such as `DIRECT_DATABASE_URL`, fails with a `--yes` hint in non-interactive shells instead of an inquirer error, and creates a new `.env` readable only by its owner.
- 85005fa: `pgbeam audit export --output` and `pgbeam account export --file` now write the file with mode 0600 and replace it in one step, so an export is never world-readable and an interrupted write never leaves a truncated file behind.
- ddfcdf8: Make the profile you log into with `pgbeam auth login` the active one. Logging into a new profile on a machine that already had one stored the credentials but left the old profile active, so the next command ran against the previous organization. The CLI now also says when it switched the active profile.
- 785927e: `pgbeam mcp` no longer answers JSON-RPC notifications such as `notifications/cancelled`, returns `-32600 Invalid Request` for messages that are not an object with a string `method`, ignores blank lines, and finishes writing replies to in-flight tool calls before exiting when stdin closes.
- 38c55f8: Escape terminal control characters in human-readable output. Audit SQL, credential names, webhook descriptions and other API values are written by agents, and an escape sequence in one of them could rewrite or hide lines in the operator's terminal. ESC, other C0 controls, DEL and C1 controls now print as a visible `\xNN` escape in tables, key/value views and the `audit session`, `agents inspect`, `agents usage` and `webhooks show` detail views. `--json` output is unchanged.
- 0abb624: `pgbeam api request` and the stdio MCP `call_endpoint` tool now refuse a path that is a full URL, protocol-relative, or uses backslashes, so your API key is never sent to another host. They also refuse `.`, `..`, empty, or slash-containing path parameters (including encoded forms like `%2e%2e`), which could otherwise turn a request into a different route than the one named.
- 9546701: API errors now print the request ID on a line under the error, and `--json` error objects include it as `request_id`, so a failure can be quoted when contacting support.
- 90a8761: `pgbeam update` checks stable downloads against the release's SHA256SUMS and refuses to install on a mismatch or a missing entry. It now stages the new binary beside the installed one, so it works when /tmp is on another filesystem, and network requests time out instead of hanging. Dev builds warn that they are unverified and need `--yes` or a confirmation.
- 7adb058: Add `--secret-stdin` to `pgbeam webhooks create` and `pgbeam webhooks update` so a signing secret can be piped in instead of passed on argv, where it lands in shell history and is visible to other local users in `ps`. One trailing newline is removed, an empty secret is rejected, and combining it with `--secret` is an error. `webhooks update` now validates `--event`, `--format` and the secret before fetching the endpoint. Writing tests for the update merge found no bug: unspecified fields, including description and event types, are carried over and an omitted secret keeps the stored one.
- 876cb6a: `agents mcp-config --client claude` now emits `"type": "http"`. Claude Code reads a `url` entry without a type as a stdio server and skips it, so the previous config never connected.
- Updated dependencies [ba058a7]
- Updated dependencies [acb171b]
- Updated dependencies [f363bd7]
- Updated dependencies [94466c2]
- Updated dependencies [958f25c]
- Updated dependencies [6cd15fe]
- Updated dependencies [289e0d3]
  - pgbeam@0.5.0

## 0.3.15

### Patch Changes

- 14df323: Approval rules can be authored: five operations under `/v1/projects/{project_id}/approval-rules` and `pgbeam approvals rules {list,create,show,update,delete}`.
- Updated dependencies [14df323]
  - pgbeam@0.4.21

## 0.3.14

### Patch Changes

- 9d6807d: The audit session summary carries `anomalies`: the alerts raised from the session's own entries, and separately the rate and shape alerts on its credentials whose window overlaps it. The field is absent when the caller's role does not hold `anomaly:read`. `pgbeam audit session` prints both lists.
- d92dcdb: Reword five API descriptions that carried em dashes into every generated reference.
- Updated dependencies [eb77c5f]
- Updated dependencies [9d6807d]
- Updated dependencies [d92dcdb]
  - pgbeam@0.4.20

## 0.3.13

### Patch Changes

- Updated dependencies [b821f90]
  - pgbeam@0.4.19

## 0.3.12

### Patch Changes

- Updated dependencies [16ed7f3]
  - pgbeam@0.4.18

## 0.3.11

### Patch Changes

- a9c235e: feat(api): anomaly rules, the authoring surface (roadmap item 4, slice 3)
- Updated dependencies [a9c235e]
  - pgbeam@0.4.17

## 0.3.10

### Patch Changes

- Updated dependencies [40af2fb]
  - pgbeam@0.4.16

## 0.3.9

### Patch Changes

- Updated dependencies [631f106]
  - pgbeam@0.4.15

## 0.3.8

### Patch Changes

- Updated dependencies [a5fbfca]
  - pgbeam@0.4.14

## 0.3.7

### Patch Changes

- 3342c65: feat(policy): content_scan_mode and content_scan_max_bytes on the policy profile
- Updated dependencies [3342c65]
  - pgbeam@0.4.13

## 0.3.6

### Patch Changes

- 3f33063: fix(sdk,cli): read the API's RFC 9457 problem documents

  `ApiError` now exposes `code`, `type`, `title`, `detail`, `instance`, `requestId` and `errors`, and its `message` comes from the document's `detail` rather than falling through to the status text. Branch on `code`: two conditions can share a status, and a 403 is either a permissions problem or a billing one. The CLI puts the code on the error line, lists field errors under it, and carries both in `--json` output.

- Updated dependencies [3f33063]
- Updated dependencies [022577d]
- Updated dependencies [eca3f27]
- Updated dependencies [c1fa878]
- Updated dependencies [9818ecf]
- Updated dependencies [3f33063]
  - pgbeam@0.4.12

## 0.3.5

### Patch Changes

- 43acb8e: feat(api): publish organization membership endpoints, split out of #2079
- 379b817: feat(webhooks): publish delivery contract and validate event types
- 43acb8e: fix(api): the member API contract claimed two things the server refuses

  `UpdateOrgMemberRoleRequest.role` and `CreateOrgInvitationRequest.role` now use a new `AssignableOrgRole` enum, which is `OrgRole` without `owner`. The server has always rejected `owner` on both paths with a 400, so every generated client, the CLI help and the reference pages were advertising a call that never works. Responses keep the full `OrgRole`, because a member really can be an owner. `role` is also no longer required on an invitation, matching the server, which defaults an absent role to `member`.

  `listOrgMembers` and `listOrgInvitations` now enforce the `page_size` range they declare. They read the query string directly and clamped anything outside 1 to 100 back to the default of 20, so `?page_size=500` was a documented 400 everywhere else in the API and a silent 20 here.

  `listOrgInvitations` now enforces the `status` enum it declares. Anything outside `pending`, `accepted`, `rejected` and `canceled` went to the database as a literal filter and came back as an empty page with a 200, so a caller who mistyped the status was told the organization has no invitations. It is a 400 now, as the contract has always said. `?status=` with no value is also a 400 rather than the unfiltered list; omit the parameter to list everything.

  `removeOrgMember`'s published description said "An owner cannot be removed; demote them first", and the server does neither half of that. It refuses only when the organization is down to its last owner, so removing any other owner returns 204, and demoting the last owner hits the same guard and returns the same 409. The description now says what the guard does: the last remaining owner cannot be removed or demoted, so transfer ownership first, which is the advice the 409 itself gives.

  Go SDK callers: nothing to migrate. `OrgRole` and `AssignableOrgRole` are both new types in `go.pgbeam.com/sdk` as of this release, which is what the minor bump is for.

- 43acb8e: fix(cli): the new organization member commands could not show a role

  `pgbeam orgs members list`, `orgs members set-role`, `orgs invitations list` and `orgs invitations create` rendered a table with no `role` column, so the command that changes a member's role could not show the role it had just set. `role` points at the `OrgRole` enum, and until #2122 the manifest generator dropped every column whose schema is a named type. This branch now builds on that fix, and the column appears in all four. On the member list it takes the slot `image` had, which was an avatar URL.

- Updated dependencies [bd2d132]
- Updated dependencies [58d0ed0]
- Updated dependencies [43acb8e]
- Updated dependencies [379b817]
- Updated dependencies [7a26954]
- Updated dependencies [8deebf2]
- Updated dependencies [43acb8e]
  - pgbeam@0.4.11

## 0.3.4

### Patch Changes

- e1229b0: fix(cli): tables dropped every field whose schema is a named type

  `pgbeam db list` did not show which databases are replicas, `pgbeam db inspect` did not show `ssl_mode`, and `pgbeam projects list` did not show whether a project is running. All three are fields the contract declares and the API returns.

  The manifest generator keeps a column only when it can read a scalar `type` off the response property, and a property that points at a named schema is a `$ref` carrying no `type`. Nothing failed: the manifest is generated and checked in, so a column that never appeared looked like a column nobody wanted. Both the parameter and the response paths now resolve one level of `$ref` before deciding.

  `db list` and `projects list` are at the eight-column limit, so each drops its lowest-priority column to make room: `project_id` on a project-scoped database list, and `cloud` on the project list.

## 0.3.3

### Patch Changes

- Updated dependencies [8b04b38]
  - pgbeam@0.4.10

## 0.3.2

### Patch Changes

- 39213c0: Remove em dashes from CLI prose. The root help description, the management MCP server's instructions and tool summaries, several command descriptions, two error messages and a handful of code comments used em dashes, which `CLAUDE.md` rule 10 forbids in prose. They are now commas, colons, parentheses or separate sentences.

  Em dashes used typographically rather than as prose punctuation are unchanged: the `—` placeholder for a missing `statement_kind` in `approvals list`, and the label separators in `auth switch`, `agents secrets` and `agents mcp-config`.

## 0.3.1

### Patch Changes

- dd2e970: chore(format): reflow prose to one line per paragraph, and let CI see it
- Updated dependencies [dd2e970]
  - pgbeam@0.4.9

## 0.3.0

### Minor Changes

- 7427b6b: Publish the CLI to npm as `@pgbeam/cli`, and to Homebrew through the `sferarc/pgbeam` tap.

  The package was private and its `bin` pointed at a TypeScript source file, so neither `npx @pgbeam/cli` nor `npm i -g @pgbeam/cli` could work. It now ships a bundled ESM entry point with a `#!/usr/bin/env node` shebang, built by bunchee like the other published packages, and runs on plain Node 20.19 or newer with no bun installed. The self-contained native binaries are unchanged and still built by `bun build --compile`; they are now also published as a GitHub release with checksums, which is what the Homebrew formula pins.

  `pgbeam update` and the background upgrade check used to fall back to the GitHub releases of the private monorepo, which answers 404 for everyone. They now read the public CLI repository, and its release tags are `vX.Y.Z`.

### Patch Changes

- Updated dependencies [6bf2e14]
  - pgbeam@0.4.8

## 0.2.16

### Patch Changes

- d3cce03: chore: release packages
- Updated dependencies [d3cce03]
  - pgbeam@0.4.7

## 0.2.15

### Patch Changes

- d3cce03: chore: release packages
- Updated dependencies [d3cce03]
  - pgbeam@0.4.6

## 0.2.14

### Patch Changes

- d3cce03: chore: release packages
- Updated dependencies [d3cce03]
  - pgbeam@0.4.5

## 0.2.13

### Patch Changes

- eb3390d: feat(usage): break down project usage by agent credential
- Updated dependencies [eb3390d]
  - pgbeam@0.4.4

## 0.2.12

### Patch Changes

- Updated dependencies [d5149ba]
  - pgbeam@0.4.3

## 0.2.11

### Patch Changes

- Updated dependencies [89e2f33]
  - pgbeam@0.4.2

## 0.2.10

### Patch Changes

- Updated dependencies [08071bd]
  - pgbeam@0.4.1

## 0.2.9

### Patch Changes

- Updated dependencies [2d6e1ee]
  - pgbeam@0.4.0

## 0.2.8

### Patch Changes

- Updated dependencies [d78ddfc]
  - pgbeam@0.3.14

## 0.2.7

### Patch Changes

- 19fd607: feat(policies): least-privilege auto-policy recommender from audit traffic (BET-1)
- Updated dependencies [19fd607]
  - pgbeam@0.3.13

## 0.2.6

### Patch Changes

- 9e9f0c0: fix(cli): P2 polish from the QA audit. `api schema` now prints the full contract schema for an operation (parameters with name, location, required and type, request body shape, response shape and status) instead of the route three ways. `api request` failures flow through the same status-aware error branch as SDK calls, with remediation hints and the response body displayed; its help no longer claims `/v1/regions` is a public endpoint (every API request is authenticated). `--json` now applies to errors too: failed commands print `{"error": {"status?", "message", "hint?"}}` to stdout and exit non-zero. Client-side file validation runs before auth resolution, so `policies dry-eval --draft ./missing.json` (and replay, update --file, migrations lint --file) reports the file problem instead of "Not authenticated"; drafts are also schema-validated locally. Verb aliases fill the asymmetry: `projects ls`/`projects show`, `db show`/`db create`, `agents inspect`, `policies inspect`, `webhooks inspect`, and `create` on `domains add`/`replicas add`. Dates render consistently everywhere as ISO date plus a relative suffix, e.g. `2026-07-22 (2d ago)`, replacing the locale-dependent format in generated tables and raw ISO timestamps in audit, anomalies, and approvals lists.

## 0.2.5

### Patch Changes

- 06f9609: feat(cli): first-run golden path. New public `GET /v1/organizations` lists the organizations visible to the caller's credential (an org-scoped `pbo_` key sees exactly its org, a user credential sees memberships with roles). `pgbeam auth login` now verifies the key against the API before storing it (a rejected key fails the login and stores nothing) and resolves the organization automatically, auto-selecting a single org and prompting a pick among several. `orgs list` shows live organizations with the active one marked (falling back to saved profiles offline) and `orgs switch` with no argument lists and picks interactively. `auth status`/`whoami` verify the credential live when online and print the masked key, method, email, and org, degrading gracefully offline; `whoami --help` now shows its own name. Top-level `pgbeam link` and `pgbeam unlink` aliases are registered so every hint that references them works, and the project link is discovered by walking ancestor directories like git. `policies create` gains the write-safety flags `update` already had (`--write-mode`, `--approval-mode`, `--approval-timeout-seconds`, `--approval-auto-max-rows`, `--migration-safety`, `--table-allowlist`, `--table-denylist`). The "No organization set" error now names the exact dashboard location to copy an org ID, the `mcp --help` example shows the real `.mcp.json` stanza, and `agents mcp-config` explains all three ways to supply credentials when input is missing.
- Updated dependencies [06f9609]
  - pgbeam@0.3.12

## 0.2.4

### Patch Changes

- 31cb990: feat(byoc): self-host enrollment hardening, optional `expires_at` on enrollment create/list and a rotate operation that mints a new `pbh_` token once and atomically invalidates the old one
- 69940db: feat(cli): read parity, policy authoring flags, and output polish. `pgbeam agents show <id>` (with `get` kept as an alias) mirrors `policies show`. `policies create` and `policies update` gain flag-based authoring (`--allow`, `--deny`, `--mask table.col=kind`, budget and limit flags), client-side validation of `--file` bodies against the contract-derived policy schema, and `--dry-run` to print the resolved profile without calling the API. Output polish: table cells truncate with an ellipsis (global `--no-trunc` shows full values), the no-table fallback renders human-readable output instead of raw JSON, API errors print remediation hints by status code, `--help` shows each command's examples, and numeric flags are validated client-side.
- Updated dependencies [31cb990]
  - pgbeam@0.3.11

## 0.2.3

### Patch Changes

- 7560db6: feat(cli): bulk anomaly acknowledge (`anomalies ack <ids...>` / `--all`); `auth login` goes straight to the API key prompt instead of showing a disabled browser option
- Updated dependencies [19a6caf]
  - pgbeam@0.3.10

## 0.2.2

### Patch Changes

- 642b681: feat(policies): traffic replay, evaluate recorded agent traffic against a candidate policy (API, CLI, dashboard, docs)
- Updated dependencies [642b681]
  - pgbeam@0.3.9

## 0.2.1

### Patch Changes

- 1ad107e: fix(cli): unquote --version, non-zero exit for unauth whoami, honest auth-login copy

## 0.2.0

### Minor Changes

- fae176d: Generate the CLI's API-surface commands from the OpenAPI contract so they can no longer drift.

  A new generator (`scripts/src/generate-cli.ts`, wired into `pnpm generate`) reads the same public OpenAPI bundle as the SDK and emits a command manifest; a small hand-written runtime turns each entry into a citty command with contract-derived flags, path parameters, pagination, tables, and detail views. The core resource reads/deletes/actions (projects, databases, agent credentials, policies, branches, custom domains) are now generated; bespoke commands (auth, mcp, env, link, interactive creators, secret rendering) stay hand-authored and compose with the generated leaves.

  Along the way this fixes several CLI bugs by construction: `domains`, `replicas`, `cache-rules`, and `env` are now registered as top-level commands (previously unreachable); `auth status`/`whoami` honor `--token` and the `PGBEAM_API_KEY`/`PGBEAM_TOKEN`/`PGBEAM_API_TOKEN` env vars instead of only the saved profile; boolean flags accept an explicit `true`/`false` value so `--flag false` is no longer silently parsed as true; and the SDK now returns the raw body for non-JSON responses (for example `text/csv`), fixing `pgbeam audit export`.

### Patch Changes

- Updated dependencies [0db5320]
- Updated dependencies [18d777f]
- Updated dependencies [fae176d]
  - pgbeam@0.3.8

## 0.1.20

### Patch Changes

- c7b5c41: Fix `pgbeam policies update` silently dropping the `max_affected_rows` write-row hard cap. The round-trip that keeps single-flag edits non-destructive now preserves `max_affected_rows`, and both `policies create` and `policies update` accept a `--max-affected-rows` flag. `policies show` prints the cap in the human summary and the `--json` output.

## 0.1.19

### Patch Changes

- Updated dependencies [320102e]
  - pgbeam@0.3.7

## 0.1.18

### Patch Changes

- Updated dependencies [bb681f4]
  - pgbeam@0.3.6

## 0.1.17

### Patch Changes

- 615a24f: feat(mcp): compact TS describe, instructions, annotations, per-tool telemetry, and OAuth challenge
- Updated dependencies [615a24f]
  - pgbeam@0.3.5

## 0.1.16

### Patch Changes

- Updated dependencies [a369073]
  - pgbeam@0.3.4

## 0.1.15

### Patch Changes

- Updated dependencies [602fe55]
  - pgbeam@0.3.3

## 0.1.14

### Patch Changes

- Updated dependencies [f2d1f56]
  - pgbeam@0.3.2

## 0.1.13

### Patch Changes

- Updated dependencies [b1d406d]
  - pgbeam@0.3.1

## 0.1.12

### Patch Changes

- Updated dependencies [728a7a5]
  - pgbeam@0.3.0

## 0.1.11

### Patch Changes

- Updated dependencies [ed8238a]
  - pgbeam@0.2.9

## 0.1.10

### Patch Changes

- Updated dependencies [4761ffe]
  - pgbeam@0.2.8

## 0.1.9

### Patch Changes

- 6ba336f: feat: agent gateway — safe Postgres access for AI agents
- Updated dependencies [6ba336f]
  - pgbeam@0.2.7

## 0.1.8

### Patch Changes

- Updated dependencies [46b2b4b]
- Updated dependencies [bc47c25]
  - pgbeam@0.2.6

## 0.1.7

### Patch Changes

- Updated dependencies [7d6e350]
  - pgbeam@0.2.5

## 0.1.6

### Patch Changes

- bbab027: Add comprehensive test coverage across backend and frontend
- Updated dependencies [bbab027]
  - pgbeam@0.2.4

## 0.1.5

### Patch Changes

- db4a0c1: feat(cli): auto-generate CLI docs from command source files
- Updated dependencies [0115d96]
- Updated dependencies [1dfa672]
  - pgbeam@0.2.3

## 0.1.4

### Patch Changes

- Updated dependencies [4ddbec1]
  - pgbeam@0.2.2

## 0.1.3

### Patch Changes

- Updated dependencies [6583d1a]
  - pgbeam@0.2.1

## 0.1.2

### Patch Changes

- ddbaa4f: fix(cli): inject version define in CI builds to fix binary verification

## 0.1.1

### Patch Changes

- a5b6ca1: Embed version at build time for CLI binaries

## 0.1.0

### Minor Changes

- 7e3b06b: CLI and SDK installation, publishing, and exposure
  - Rename SDK package to `pgbeam` for npm publishing
  - Set up changesets for automated versioning and releases
  - Add GitHub Actions release workflow (npm publish + CLI S3 upload)
  - Add CLI upgrade notifier with S3 version checking and 24h cache
  - Rewrite CLI install script with cross-platform support
  - Add CLI section to marketing landing page
  - Update docs with install options and MCP server details
  - Add pgbeam-releases S3 bucket to Pulumi IaC

### Patch Changes

- Updated dependencies [7e3b06b]
  - pgbeam@0.2.0
