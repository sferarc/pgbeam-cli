/**
 * Minimal semantic-version parsing and comparison, shared by the `update`
 * command and the background upgrade notifier so the two never drift on how a
 * version string is read or which of two versions counts as newer.
 */

export interface Semver {
  major: number;
  minor: number;
  patch: number;
}

/** Parse the leading `major.minor.patch` of a version string, ignoring a `v` prefix. */
export function parseSemver(version: string): Semver | null {
  const clean = version.replace(/^v/, "");
  const match = clean.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** Whether `latest` is strictly newer than `current`. Unparseable input is never newer. */
export function isNewer(current: string, latest: string): boolean {
  const c = parseSemver(current);
  const l = parseSemver(latest);
  if (!c || !l) return false;
  if (l.major !== c.major) return l.major > c.major;
  if (l.minor !== c.minor) return l.minor > c.minor;
  return l.patch > c.patch;
}
