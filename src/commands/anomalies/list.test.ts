import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("citty", () => ({
  defineCommand: (config: Record<string, unknown>) => config,
}));

vi.mock("../../lib/flags.js", () => ({
  globalArgs: {},
}));

vi.mock("../../lib/client.js", () => ({
  resolveContext: vi.fn(),
  requireProject: vi.fn(),
}));

vi.mock("../../lib/errors.js", () => ({
  runCommand: vi.fn(async (fn: () => Promise<void>) => fn()),
}));

vi.mock("../../lib/output.js", () => ({
  output: vi.fn(),
  outputTable: vi.fn(),
  formatDate: vi.fn((value: unknown) => String(value ?? "-")),
}));

vi.mock("consola", () => ({
  consola: { info: vi.fn(), log: vi.fn() },
}));

import { requireProject, resolveContext } from "../../lib/client.js";
import { output } from "../../lib/output.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mockListAnomalyAlerts = vi.fn();

function setupContext(projectId = "proj-1") {
  vi.mocked(resolveContext).mockReturnValue({
    client: {
      anomalies: { listAnomalyAlerts: mockListAnomalyAlerts },
    },
    orgId: "org-1",
    projectId,
  } as never);
  vi.mocked(requireProject).mockReturnValue(projectId);
}

async function runHandler(args: Record<string, unknown>) {
  const mod = await import("./list.js");
  const command = mod.default;
  await command.run?.({ args: { json: false, "no-color": false, debug: false, ...args } } as never);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
});

describe("anomalies list", () => {
  it("calls listAnomalyAlerts without status filter by default", async () => {
    setupContext();
    mockListAnomalyAlerts.mockResolvedValue({ anomalies: [] });

    await runHandler({});

    expect(mockListAnomalyAlerts).toHaveBeenCalledWith({
      pathParams: { project_id: "proj-1" },
      queryParams: { page_size: 50 },
    });
  });

  it("includes status in query params when provided", async () => {
    setupContext();
    mockListAnomalyAlerts.mockResolvedValue({ anomalies: [] });

    await runHandler({ status: "open" });

    expect(mockListAnomalyAlerts).toHaveBeenCalledWith({
      pathParams: { project_id: "proj-1" },
      queryParams: { page_size: 50, status: "open" },
    });
  });

  it("invokes output with the result", async () => {
    setupContext();
    const result = {
      anomalies: [
        {
          id: "anom-1",
          project_id: "proj-1",
          kind: "query_spike",
          severity: "warning",
          title: "Unusual query volume",
          status: "open",
          created_at: "2026-06-14T00:00:00Z",
        },
      ],
    };
    mockListAnomalyAlerts.mockResolvedValue(result);

    await runHandler({});

    expect(output).toHaveBeenCalledWith(result, false, expect.any(Function));
  });

  it("invokes output with json=true when --json is set", async () => {
    setupContext();
    const result = { anomalies: [] };
    mockListAnomalyAlerts.mockResolvedValue(result);

    await runHandler({ json: true });

    expect(output).toHaveBeenCalledWith(result, true, expect.any(Function));
  });

  it("table callback shows empty message when no anomalies", async () => {
    setupContext();
    mockListAnomalyAlerts.mockResolvedValue({ anomalies: [] });
    await runHandler({});

    const { consola } = await import("consola");
    const tableFn = vi.mocked(output).mock.calls[0][2] as () => void;
    tableFn();
    expect(consola.info).toHaveBeenCalledWith("No anomaly alerts found.");
  });

  it("table callback renders rows with outputTable and truncates long titles", async () => {
    setupContext();
    const longTitle = "x".repeat(60);
    const result = {
      anomalies: [
        {
          id: "anom-1",
          project_id: "proj-1",
          kind: "query_spike",
          severity: "critical",
          title: longTitle,
          status: "open",
          created_at: "2026-06-14T00:00:00Z",
        },
      ],
    };
    mockListAnomalyAlerts.mockResolvedValue(result);
    await runHandler({});

    const { outputTable } = await import("../../lib/output.js");
    const tableFn = vi.mocked(output).mock.calls[0][2] as () => void;
    tableFn();
    expect(outputTable).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: "anom-1",
          severity: "critical",
          kind: "query_spike",
          status: "open",
          title: `${"x".repeat(39)}…`,
        }),
      ]),
      expect.any(Array),
    );
  });
});
