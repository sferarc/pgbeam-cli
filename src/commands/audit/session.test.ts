import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { consola } from "consola";
import { requireProject, resolveContext } from "../../lib/client.js";
import sessionCommand from "./session.js";

const run = sessionCommand.run;
if (!run) throw new Error("command.run is not defined");

const mockGetAuditSessionSummary = vi.fn();
const baseArgs = { json: false, "no-color": false, debug: false };

const SUMMARY = {
  session_id: "0000a41f",
  project_id: "prj_1",
  credential_ids: ["agt_one"],
  sources: ["wire"],
  started_at: "2026-08-26T09:00:00Z",
  ended_at: "2026-08-26T09:04:00Z",
  duration_ms: 240000,
  entries_scanned: 5,
  statements: 5,
  allowed: 3,
  blocked: 1,
  masked: 1,
  truncated: 0,
  other: 0,
  rows_returned: 120,
  bytes_out: 4096,
  latency_ms_total: 12.5,
  tables_read: ["public.orders", "public.users"],
  tables_written: [],
  tables_blocked: ["billing.cards"],
  unparsed_statements: 0,
  scan_truncated: false,
};

/** All human output as one string, for substring assertions. */
function printed(): string {
  return vi
    .mocked(consola.log)
    .mock.calls.map((c) => String(c[0]))
    .join("\n");
}

describe("audit session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveContext).mockReturnValue({
      client: { agents: { getAuditSessionSummary: mockGetAuditSessionSummary } } as never,
      orgId: "org_123",
      projectId: "prj_1",
    });
    vi.mocked(requireProject).mockReturnValue("prj_1");
    mockGetAuditSessionSummary.mockResolvedValue(SUMMARY);
  });

  it("requests the summary for the positional session ID", async () => {
    await run({ args: { ...baseArgs, "session-id": "0000a41f" } } as never);

    expect(mockGetAuditSessionSummary).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_1", session_id: "0000a41f" },
      queryParams: {},
    });
  });

  it("forwards the window filters", async () => {
    await run({
      args: {
        ...baseArgs,
        "session-id": "0000a41f",
        start: "2026-01-01T00:00:00Z",
        end: "2026-02-01T00:00:00Z",
      },
    } as never);

    expect(mockGetAuditSessionSummary).toHaveBeenCalledWith({
      pathParams: { project_id: "prj_1", session_id: "0000a41f" },
      queryParams: { start: "2026-01-01T00:00:00Z", end: "2026-02-01T00:00:00Z" },
    });
  });

  it("prints the counts and the table lists", async () => {
    await run({ args: { ...baseArgs, "session-id": "0000a41f" } } as never);

    const out = printed();
    expect(out).toContain("0000a41f");
    expect(out).toContain("5 (3 allowed, 1 blocked, 1 masked, 0 truncated)");
    expect(out).toContain("public.orders, public.users");
    expect(out).toContain("billing.cards");
    // A session that wrote nothing prints a dash, not an empty line.
    expect(out).toContain("Written:     -");
    expect(consola.warn).not.toHaveBeenCalled();
  });

  it("warns when the table lists are incomplete", async () => {
    mockGetAuditSessionSummary.mockResolvedValue({
      ...SUMMARY,
      unparsed_statements: 2,
      scan_truncated: true,
    });

    await run({ args: { ...baseArgs, "session-id": "0000a41f" } } as never);

    expect(consola.warn).toHaveBeenCalledTimes(2);
    expect(vi.mocked(consola.warn).mock.calls[0][0]).toContain("2 statement(s)");
    expect(vi.mocked(consola.warn).mock.calls[1][0]).toContain("more entries than one summary");
  });

  it("rejects a missing session ID", async () => {
    await expect(run({ args: { ...baseArgs } } as never)).rejects.toThrow(/session-id/);
    expect(mockGetAuditSessionSummary).not.toHaveBeenCalled();
  });
});
