import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("consola", () => ({
  consola: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    log: vi.fn(),
  },
}));

vi.mock("../../lib/client.js", () => ({
  resolveContext: vi.fn(),
  requireProject: vi.fn(),
}));

vi.mock("../../lib/errors.js", () => ({
  runCommand: vi.fn(async (fn) => fn()),
}));

vi.mock("../../lib/output.js", () => ({
  output: vi.fn((data, json, tableFn) => {
    void data;
    if (json) return;
    if (tableFn) tableFn();
  }),
  outputJson: vi.fn(),
}));

import { consola } from "consola";
import { requireProject, resolveContext } from "../../lib/client.js";
import { outputJson } from "../../lib/output.js";
import createCommand from "./create.js";

const run = createCommand.run;
if (!run) throw new Error("command.run is not defined");

const mockCreatePolicyProfile = vi.fn();

const baseArgs = { json: false, "no-color": false, debug: false, "dry-run": false };

const tmp = mkdtempSync(join(tmpdir(), "pgbeam-create-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("policies create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveContext).mockReturnValue({
      client: {
        policies: { createPolicyProfile: mockCreatePolicyProfile },
      } as never,
      orgId: "org_123",
      projectId: "prj_linked",
    });
    vi.mocked(requireProject).mockReturnValue("prj_linked");
    mockCreatePolicyProfile.mockResolvedValue({ id: "pol_new", name: "read-only" });
  });

  it("creates from name and mode", async () => {
    await run({ args: { ...baseArgs, name: "read-only", mode: "read_only" } } as never);

    expect(mockCreatePolicyProfile).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_linked" },
      body: { name: "read-only", access_mode: "read_only" },
    });
    expect(consola.success).toHaveBeenCalledWith("Policy profile created: pol_new");
  });

  it("builds allow, deny, and mask flags into the request body", async () => {
    await run({
      args: { ...baseArgs, name: "support", mask: "users.email=redact" },
      rawArgs: [
        "--name",
        "support",
        "--allow",
        "public.users",
        "--allow",
        "public.orders",
        "--deny",
        "public.secrets",
        "--mask",
        "users.email=redact",
      ],
    } as never);

    expect(mockCreatePolicyProfile).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_linked" },
      body: {
        name: "support",
        table_allowlist: ["public.users", "public.orders"],
        table_denylist: ["public.secrets"],
        masking_rules: [{ table: "users", column: "email", kind: "redact" }],
      },
    });
  });

  it("builds budget and limit flags into the request body", async () => {
    await run({
      args: {
        ...baseArgs,
        name: "bots",
        "max-rows": "1000",
        "max-affected-rows": "50",
        "budget-queries-per-hour": "100",
        "budget-queries-per-day": "5000",
        "egress-bytes-per-day": "1000000",
        "statement-timeout-ms": "3000",
      },
    } as never);

    expect(mockCreatePolicyProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          name: "bots",
          max_rows: 1000,
          max_affected_rows: 50,
          budget_queries_per_hour: 100,
          budget_queries_per_day: 5000,
          egress_bytes_per_day: 1000000,
          statement_timeout_ms: 3000,
        },
      }),
    );
  });

  it("builds write-safety flags into the request body (parity with update)", async () => {
    await run({
      args: {
        ...baseArgs,
        name: "deploys",
        mode: "read_write",
        "write-mode": "rollback",
        "approval-mode": "ddl",
        "approval-timeout-seconds": "120",
        "approval-auto-max-rows": "10",
        "migration-safety": "warn",
        "table-allowlist": "public.users, public.orders",
        "table-denylist": "public.secrets",
      },
    } as never);

    expect(mockCreatePolicyProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          name: "deploys",
          access_mode: "read_write",
          write_mode: "rollback",
          approval_mode: "ddl",
          approval_timeout_seconds: 120,
          approval_auto_max_rows: 10,
          migration_safety: "warn",
          table_allowlist: ["public.users", "public.orders"],
          table_denylist: ["public.secrets"],
        },
      }),
    );
  });

  it("rejects an invalid --write-mode with a clear message", async () => {
    await expect(
      run({ args: { ...baseArgs, name: "x", "write-mode": "yolo" } } as never),
    ).rejects.toThrow(/Invalid write-mode: "yolo".*normal, rollback, sandbox/);
    expect(mockCreatePolicyProfile).not.toHaveBeenCalled();
  });

  it("rejects an invalid --approval-mode with a clear message", async () => {
    await expect(
      run({ args: { ...baseArgs, name: "x", "approval-mode": "sometimes" } } as never),
    ).rejects.toThrow(/Invalid approval-mode: "sometimes".*off, writes, ddl, all/);
    expect(mockCreatePolicyProfile).not.toHaveBeenCalled();
  });

  it("--dry-run includes the write-safety flags in the resolved body", async () => {
    await run({
      args: {
        ...baseArgs,
        name: "preview",
        mode: "read_write",
        "write-mode": "sandbox",
        "migration-safety": "block",
        "dry-run": true,
      },
    } as never);

    expect(outputJson).toHaveBeenCalledWith({
      name: "preview",
      access_mode: "read_write",
      write_mode: "sandbox",
      migration_safety: "block",
    });
    expect(mockCreatePolicyProfile).not.toHaveBeenCalled();
  });

  it("rejects an invalid --mask kind with a clear message", async () => {
    await expect(
      run({ args: { ...baseArgs, name: "x", mask: "users.email=scramble" } } as never),
    ).rejects.toThrow(/Invalid --mask kind "scramble".*redact, null, hash/);
    expect(mockCreatePolicyProfile).not.toHaveBeenCalled();
  });

  it("overlays --file with individual flags", async () => {
    const path = join(tmp, "policy.json");
    writeFileSync(path, JSON.stringify({ access_mode: "read_only", max_rows: 10 }));

    await run({
      args: { ...baseArgs, name: "analytics", file: path, "max-rows": "99" },
    } as never);

    expect(mockCreatePolicyProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { name: "analytics", access_mode: "read_only", max_rows: 99 },
      }),
    );
  });

  it("rejects a --file body that fails schema validation", async () => {
    const path = join(tmp, "bad-policy.json");
    writeFileSync(path, JSON.stringify({ access_mode: "yolo", allowlist: ["users"] }));

    await expect(run({ args: { ...baseArgs, name: "x", file: path } } as never)).rejects.toThrow(
      /Invalid policy profile \(--file .*bad-policy\.json\)[\s\S]*access_mode[\s\S]*allowlist/,
    );
    expect(mockCreatePolicyProfile).not.toHaveBeenCalled();
  });

  it("rejects a --file that is not valid JSON", async () => {
    const path = join(tmp, "not-json.json");
    writeFileSync(path, "{ nope");

    await expect(run({ args: { ...baseArgs, name: "x", file: path } } as never)).rejects.toThrow(
      /is not valid JSON/,
    );
    expect(mockCreatePolicyProfile).not.toHaveBeenCalled();
  });

  it("--dry-run prints the resolved body and never calls the API", async () => {
    await run({
      args: { ...baseArgs, name: "preview", mode: "read_only", "dry-run": true },
      rawArgs: ["--name", "preview", "--mode", "read_only", "--allow", "public.users", "--dry-run"],
    } as never);

    expect(outputJson).toHaveBeenCalledWith({
      name: "preview",
      access_mode: "read_only",
      table_allowlist: ["public.users"],
    });
    expect(consola.info).toHaveBeenCalledWith(expect.stringContaining("policies dry-eval"));
    expect(resolveContext).not.toHaveBeenCalled();
    expect(mockCreatePolicyProfile).not.toHaveBeenCalled();
  });

  it("outputs JSON when --json is set", async () => {
    const result = { id: "pol_new", name: "read-only" };
    mockCreatePolicyProfile.mockResolvedValue(result);

    const { output } = await import("../../lib/output.js");
    await run({ args: { ...baseArgs, name: "read-only", json: true } } as never);

    expect(output).toHaveBeenCalledWith(result, true, expect.any(Function));
  });
});
