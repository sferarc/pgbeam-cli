import type { SSLModeKey } from "pgbeam";

/** Require a string argument, throw if missing. */
export function requireArg(value: string | boolean | undefined, name: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
}

/** Coerce an optional arg to string or undefined (never boolean). */
export function optionalArg(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Typed Object.entries that preserves key type for const objects. */
export function typedEntries<K extends string, V>(obj: Record<K, V>): [K, V][] {
  return Object.entries(obj) as [K, V][];
}

/** SSL mode enum values matching the SDK SSLMode type. */
export const sslModes = {
  disable: "disable",
  allow: "allow",
  prefer: "prefer",
  require: "require",
  "verify-ca": "verify-ca",
  "verify-full": "verify-full",
} satisfies Record<string, SSLModeKey>;

/** Pool mode enum values. */
export const poolModes = {
  session: "session",
  transaction: "transaction",
  statement: "statement",
} as const;

/** Insights range enum values. */
export const insightRanges = {
  "1h": "1h",
  "6h": "6h",
  "24h": "24h",
  "7d": "7d",
} as const;

/** Look up a string in an enum object, returning the typed value. Throws if invalid. */
export function parseEnum<T extends Record<string, string>>(
  value: string,
  enumObj: T,
  name: string,
): T[keyof T] {
  if (value in enumObj) {
    return enumObj[value as keyof T];
  }
  throw new Error(`Invalid ${name}: "${value}". Allowed: ${Object.keys(enumObj).join(", ")}`);
}

/** Parse and validate a numeric string. Throws if not a valid number. */
export function parseNumber(value: string, name: string): number {
  const num = Number(value);
  if (Number.isNaN(num)) {
    throw new Error(`Invalid ${name}: "${value}" is not a number.`);
  }
  return num;
}

/** Multipliers (in milliseconds) for each supported duration shorthand unit. */
const expiryUnitMillis = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
} as const;

/**
 * Parse a credential expiry into a normalized ISO 8601 timestamp.
 *
 * Accepts either:
 * - a relative duration shorthand `<number><unit>` where unit is one of
 *   `s` (seconds), `m` (minutes), `h` (hours), `d` (days), `w` (weeks) —
 *   e.g. `30d`, `12h`, `90m`, `2w`, `3600s` — returning `now + duration`; or
 * - an absolute ISO 8601 datetime (e.g. `2026-12-31T23:59:00Z`) — returning it
 *   normalized via `Date.prototype.toISOString()`.
 *
 * Throws an `Error` for unparseable input, zero/negative durations, unknown
 * units, and absolute timestamps that are not strictly in the future.
 */
export function parseExpiry(value: string, now: Date = new Date()): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new Error(`Invalid --expires: "${value}" is empty.`);
  }

  const durationMatch = /^(-?\d+)([a-zA-Z]+)$/.exec(trimmed);
  if (durationMatch) {
    const amount = Number(durationMatch[1]);
    const unit = durationMatch[2];
    if (!(unit in expiryUnitMillis)) {
      throw new Error(
        `Invalid --expires: "${value}" has an unknown unit "${unit}". Allowed units: ${Object.keys(expiryUnitMillis).join(", ")}.`,
      );
    }
    if (amount <= 0) {
      throw new Error(`Invalid --expires: "${value}" must be a positive duration.`);
    }
    const millis = amount * expiryUnitMillis[unit as keyof typeof expiryUnitMillis];
    return new Date(now.getTime() + millis).toISOString();
  }

  const absolute = new Date(trimmed);
  if (Number.isNaN(absolute.getTime())) {
    throw new Error(
      `Invalid --expires: "${value}" is not a duration (e.g. 30d) or a valid ISO 8601 timestamp.`,
    );
  }
  if (absolute.getTime() <= now.getTime()) {
    throw new Error(`Invalid --expires: "${value}" must be in the future.`);
  }
  return absolute.toISOString();
}
