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

vi.mock("consola", () => ({
  consola: { success: vi.fn(), info: vi.fn(), log: vi.fn() },
}));

import { consola } from "consola";
import { requireProject, resolveContext } from "../../lib/client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mockUpdateAnomalyAlert = vi.fn();
const mockListAnomalyAlerts = vi.fn();

function setupContext(projectId = "proj-1") {
  vi.mocked(resolveContext).mockReturnValue({
    client: {
      anomalies: {
        updateAnomalyAlert: mockUpdateAnomalyAlert,
        listAnomalyAlerts: mockListAnomalyAlerts,
      },
    },
    orgId: "org-1",
    projectId,
  } as never);
  vi.mocked(requireProject).mockReturnValue(projectId);
}

async function runHandler(args: Record<string, unknown>) {
  const mod = await import("./ack.js");
  const command = mod.default;
  await command.run?.({
    args: { json: false, "no-color": false, debug: false, all: false, ...args },
  } as never);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
});

describe("anomalies ack", () => {
  it("calls updateAnomalyAlert with acknowledged status", async () => {
    setupContext();
    mockUpdateAnomalyAlert.mockResolvedValue({});

    await runHandler({ id: "anom-1" });

    expect(mockUpdateAnomalyAlert).toHaveBeenCalledWith({
      pathParams: { project_id: "proj-1", anomaly_id: "anom-1" },
      body: { status: "acknowledged" },
    });
  });

  it("reports success", async () => {
    setupContext();
    mockUpdateAnomalyAlert.mockResolvedValue({});

    await runHandler({ id: "anom-1" });

    expect(consola.success).toHaveBeenCalledWith("Anomaly anom-1 acknowledged.");
  });

  it("acknowledges multiple IDs and dedupes the positional list", async () => {
    setupContext();
    mockUpdateAnomalyAlert.mockResolvedValue({});

    await runHandler({ id: "anom-1", _: ["anom-1", "anom-2", "anom-3"] });

    expect(mockUpdateAnomalyAlert).toHaveBeenCalledTimes(3);
    expect(mockUpdateAnomalyAlert).toHaveBeenCalledWith({
      pathParams: { project_id: "proj-1", anomaly_id: "anom-2" },
      body: { status: "acknowledged" },
    });
    expect(consola.success).toHaveBeenCalledWith("Acknowledged 3 anomaly alerts.");
  });

  it("acknowledges every open alert with --all, following pagination", async () => {
    setupContext();
    mockListAnomalyAlerts
      .mockResolvedValueOnce({
        anomalies: [{ id: "anom-1" }, { id: "anom-2" }],
        next_page_token: "tok",
      })
      .mockResolvedValueOnce({ anomalies: [{ id: "anom-3" }] });
    mockUpdateAnomalyAlert.mockResolvedValue({});

    await runHandler({ all: true });

    expect(mockListAnomalyAlerts).toHaveBeenCalledWith({
      pathParams: { project_id: "proj-1" },
      queryParams: { status: "open", page_size: 100 },
    });
    expect(mockListAnomalyAlerts).toHaveBeenCalledWith({
      pathParams: { project_id: "proj-1" },
      queryParams: { status: "open", page_size: 100, page_token: "tok" },
    });
    expect(mockUpdateAnomalyAlert).toHaveBeenCalledTimes(3);
    expect(consola.success).toHaveBeenCalledWith("Acknowledged 3 anomaly alerts.");
  });

  it("reports when --all finds no open alerts", async () => {
    setupContext();
    mockListAnomalyAlerts.mockResolvedValue({ anomalies: [] });

    await runHandler({ all: true });

    expect(mockUpdateAnomalyAlert).not.toHaveBeenCalled();
    expect(consola.info).toHaveBeenCalledWith("No open anomaly alerts to acknowledge.");
  });

  it("rejects mixing IDs with --all", async () => {
    setupContext();

    await expect(runHandler({ id: "anom-1", all: true })).rejects.toThrow(
      "Pass either alert IDs or --all, not both.",
    );
    expect(mockUpdateAnomalyAlert).not.toHaveBeenCalled();
  });

  it("rejects when no ID and no --all is given", async () => {
    setupContext();

    await expect(runHandler({})).rejects.toThrow(
      "Provide at least one anomaly alert ID, or use --all for every open alert.",
    );
  });

  it("continues past failures and reports a partial-failure summary", async () => {
    setupContext();
    mockUpdateAnomalyAlert
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({});

    await expect(runHandler({ _: ["anom-1", "anom-2", "anom-3"] })).rejects.toThrow(
      "Acknowledged 2, failed 1: anom-2. Retry the rest.",
    );
    expect(mockUpdateAnomalyAlert).toHaveBeenCalledTimes(3);
  });
});
