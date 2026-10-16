import { consola } from "consola";

export function outputJson(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

/**
 * Consistent date rendering for tables and detail views: ISO date (YYYY-MM-DD)
 * plus a short relative suffix, e.g. "2026-07-22 (2d ago)". One format for
 * every command, replacing locale-dependent toLocaleDateString in some places
 * and raw ISO timestamps in others. Timestamps are kept intact under --json.
 */
export function formatDate(value: unknown, now: Date = new Date()): string {
  if (value === null || value === undefined || value === "") return "-";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  const iso = date.toISOString().slice(0, 10);
  return `${iso} (${relativeTime(date, now)})`;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

/** Short relative-time phrase ("2d ago", "in 3h", "just now"). */
function relativeTime(date: Date, now: Date): string {
  const diffMs = now.getTime() - date.getTime();
  const abs = Math.abs(diffMs);
  if (abs < MINUTE_MS) return "just now";

  let amount: number;
  let unit: string;
  if (abs < HOUR_MS) {
    amount = Math.floor(abs / MINUTE_MS);
    unit = "m";
  } else if (abs < DAY_MS) {
    amount = Math.floor(abs / HOUR_MS);
    unit = "h";
  } else if (abs < MONTH_MS) {
    amount = Math.floor(abs / DAY_MS);
    unit = "d";
  } else if (abs < YEAR_MS) {
    amount = Math.floor(abs / MONTH_MS);
    unit = "mo";
  } else {
    amount = Math.floor(abs / YEAR_MS);
    unit = "y";
  }

  return diffMs >= 0 ? `${amount}${unit} ago` : `in ${amount}${unit}`;
}

/** Default cap on rendered table cell width; `--no-trunc` disables it. */
const MAX_CELL_WIDTH = 60;

export interface TableOptions {
  /** Truncate wide cells with an ellipsis. Defaults to the --no-trunc flag. */
  truncate?: boolean;
  /** Maximum cell width when truncation is on. */
  maxCellWidth?: number;
}

/**
 * Whether table cells should be truncated for the current invocation. Read from
 * argv at call time (rather than plumbed through every command) because it is a
 * pure output concern shared by all table-rendering commands.
 */
function truncationEnabled(): boolean {
  return !process.argv.includes("--no-trunc");
}

/**
 * Replace C0 controls (except tab), DEL and C1 controls with a visible `\xNN`
 * escape. API values such as audited SQL text or credential names are written
 * by agents, and an ESC, CSI (0x9b) or OSC sequence in them would otherwise be
 * interpreted by the operator's terminal.
 */
export function sanitizeForTerminal(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    const control = (code < 0x20 && code !== 0x09) || (code >= 0x7f && code <= 0x9f);
    out += control ? `\\x${code.toString(16).padStart(2, "0")}` : s[i];
  }
  return out;
}

/** A value on one terminal line: newlines collapsed, control characters escaped. */
function renderInline(value: string): string {
  return sanitizeForTerminal(value.replace(/\s*\r?\n\s*/g, " "));
}

/** Render a table cell: newlines collapsed, optionally capped with an ellipsis. */
function renderCell(value: unknown, truncate: boolean, maxWidth: number): string {
  const flat = renderInline(String(value ?? ""));
  if (!truncate || flat.length <= maxWidth) return flat;
  return `${flat.slice(0, maxWidth - 1)}…`;
}

export function outputTable(
  rows: Record<string, unknown>[],
  columns?: { key: string; label?: string }[],
  options?: TableOptions,
): void {
  if (rows.length === 0) {
    consola.info("No results.");
    return;
  }

  const truncate = options?.truncate ?? truncationEnabled();
  const maxWidth = options?.maxCellWidth ?? MAX_CELL_WIDTH;
  const cols = columns ?? Object.keys(rows[0]).map((key) => ({ key, label: key }));

  // Render each cell once, then pad columns to the widest rendered value.
  const rendered = rows.map((row) =>
    cols.map((col) => renderCell(row[col.key], truncate, maxWidth)),
  );
  const headers = cols.map((col) => renderInline((col.label ?? col.key).toUpperCase()));
  const widths = headers.map((header, i) => {
    const maxData = rendered.reduce((max, cells) => Math.max(max, cells[i].length), 0);
    return Math.max(header.length, maxData);
  });

  // Header
  const header = headers.map((label, i) => label.padEnd(widths[i]));
  consola.log(header.join("  "));

  // Rows
  for (const cells of rendered) {
    consola.log(cells.map((cell, i) => cell.padEnd(widths[i])).join("  "));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Generic human rendering for commands that pass no table function: arrays of
 * records render as a table, records as aligned key/value lines, and anything
 * else as plain text. Raw JSON is reserved for --json.
 */
function outputHuman(data: unknown): void {
  if (Array.isArray(data)) {
    if (data.every(isRecord)) {
      outputTable(data);
      return;
    }
    for (const item of data) {
      consola.log(renderInline(typeof item === "object" ? JSON.stringify(item) : String(item)));
    }
    return;
  }
  if (isRecord(data)) {
    const keys = Object.keys(data);
    if (keys.length === 0) {
      consola.log("{}");
      return;
    }
    const labels = keys.map(renderInline);
    const width = Math.max(...labels.map((k) => k.length)) + 1;
    keys.forEach((key, i) => {
      const value = data[key];
      const renderedValue =
        value === null || value === undefined
          ? "-"
          : typeof value === "object"
            ? sanitizeForTerminal(JSON.stringify(value))
            : renderInline(String(value));
      consola.log(`${`${labels[i]}:`.padEnd(width + 1)} ${renderedValue}`);
    });
    return;
  }
  consola.log(renderInline(String(data)));
}

export function output(data: unknown, json: boolean, tableFn?: () => void): void {
  if (json) {
    outputJson(data);
  } else if (tableFn) {
    tableFn();
  } else {
    outputHuman(data);
  }
}
