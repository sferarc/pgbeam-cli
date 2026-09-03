import { connect } from "node:net";

/**
 * Best-effort network reachability probes used by `pgbeam doctor`. Kept in one
 * small module so the diagnostic command stays declarative and the probes can be
 * mocked wholesale in tests. None of these ever throw: a failure is reported in
 * the returned result so a check degrades to a warning instead of crashing the
 * CLI offline.
 */

export interface TcpProbeResult {
  ok: boolean;
  /** Round-trip time to establish the socket, in milliseconds. */
  ms: number;
  /** A short, secret-free description of why the probe failed. */
  error?: string;
}

const DEFAULT_TCP_TIMEOUT_MS = 4000;

/**
 * Open a TCP socket to host:port and close it immediately. Reports whether the
 * port accepts connections. This is deliberately a plain TCP check: the proxy's
 * Postgres port negotiates TLS in-band (not a raw TLS handshake), so "the port
 * is reachable" is the strongest signal a credential-free probe can give.
 */
export function probeTcp(
  host: string,
  port: number,
  timeoutMs: number = DEFAULT_TCP_TIMEOUT_MS,
): Promise<TcpProbeResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    let settled = false;
    const socket = connect({ host, port });

    const finish = (result: TcpProbeResult): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish({ ok: true, ms: Date.now() - start }));
    socket.once("timeout", () =>
      finish({ ok: false, ms: Date.now() - start, error: `timed out after ${timeoutMs}ms` }),
    );
    socket.once("error", (err: Error) =>
      finish({ ok: false, ms: Date.now() - start, error: err.message }),
    );
  });
}

export interface McpProbeResult {
  /** The endpoint answered an HTTP request (any status, including 401). */
  reachable: boolean;
  /** HTTP status of the last response, when one was received. */
  status?: number;
  /** Tool names returned by `tools/list`, when the endpoint was queried with a token. */
  tools?: string[];
  /** A short, secret-free description of why the probe failed. */
  error?: string;
}

const DEFAULT_HTTP_TIMEOUT_MS = 6000;

async function postJsonRpc(
  url: string,
  token: string | null,
  body: unknown,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    return await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function extractToolNames(payload: unknown): string[] | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const result = (payload as { result?: unknown }).result;
  if (typeof result !== "object" || result === null) return undefined;
  const tools = (result as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) return undefined;
  const names: string[] = [];
  for (const tool of tools) {
    if (tool && typeof tool === "object" && typeof (tool as { name?: unknown }).name === "string") {
      names.push((tool as { name: string }).name);
    }
  }
  return names;
}

/**
 * Probe a hosted MCP endpoint. Without a token, this only confirms the endpoint
 * answers (a 401 still proves reachability). With a token, it issues an MCP
 * `tools/list` and returns the tool names so the caller can verify the expected
 * agent-database tools are present. The token is only ever sent as a bearer
 * header and never returned or logged.
 */
export async function probeMcp(
  url: string,
  token: string | null,
  timeoutMs: number = DEFAULT_HTTP_TIMEOUT_MS,
): Promise<McpProbeResult> {
  try {
    if (!token) {
      // A cheap unauthenticated ping. Any HTTP response (including 401/405)
      // proves the endpoint is reachable.
      const res = await postJsonRpc(
        url,
        null,
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        timeoutMs,
      );
      return { reachable: true, status: res.status };
    }

    const res = await postJsonRpc(
      url,
      token,
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      timeoutMs,
    );
    if (!res.ok) {
      return { reachable: true, status: res.status };
    }
    const payload: unknown = await res.json().catch(() => null);
    const tools = extractToolNames(payload);
    return { reachable: true, status: res.status, ...(tools ? { tools } : {}) };
  } catch (err) {
    const error =
      err instanceof Error
        ? err.name === "AbortError"
          ? "request timed out"
          : err.message
        : String(err);
    return { reachable: false, error };
  }
}
