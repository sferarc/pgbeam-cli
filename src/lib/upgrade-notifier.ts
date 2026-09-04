import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { consola } from "consola";
import { VERSION } from "./constants.js";
import { isNewer, parseSemver } from "./semver.js";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const S3_LATEST_URL = "https://pgbeam-releases.s3.amazonaws.com/cli/latest/version.txt";
/**
 * The public CLI repository, which is where the release binaries and their
 * checksums are published. This used to point at `sferarc/pgbeam`, the private
 * monorepo, so the fallback answered 404 for everyone and named a repository an
 * outside reader cannot open.
 */
const GITHUB_RELEASES_URL = "https://api.github.com/repos/sferarc/pgbeam-cli/releases";
/** Release tags on the CLI repository are `vX.Y.Z`, matching the npm version. */
const RELEASE_TAG = /^v(\d+\.\d+\.\d+.*)$/;

interface VersionCache {
  latestVersion: string;
  checkedAt: number;
}

function cacheDir(): string {
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "pgbeam");
  }
  const xdg = process.env.XDG_CACHE_HOME;
  const base = xdg || join(homedir(), ".cache");
  return join(base, "pgbeam");
}

function cachePath(): string {
  return join(cacheDir(), "version-check.json");
}

function isVersionCache(value: unknown): value is VersionCache {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).latestVersion === "string" &&
    typeof (value as Record<string, unknown>).checkedAt === "number"
  );
}

function readCache(): VersionCache | null {
  const path = cachePath();
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    return isVersionCache(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(data: VersionCache): void {
  const dir = cacheDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(cachePath(), JSON.stringify(data));
}

/** Fetch with a per-request timeout. */
async function fetchWithTimeout(url: string, headers: Record<string, string>): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    return await fetch(url, { signal: controller.signal, headers });
  } finally {
    clearTimeout(timeout);
  }
}

/** Fetch the latest CLI version from S3 or GitHub. */
async function fetchLatestVersion(): Promise<string | null> {
  try {
    // Try S3 first
    const s3Response = await fetchWithTimeout(S3_LATEST_URL, { Accept: "text/plain" });
    if (s3Response.ok) {
      const text = await s3Response.text();
      const version = text.trim().replace(/^v/, "");
      if (parseSemver(version)) return version;
    }
  } catch {
    // S3 failed, try GitHub
  }

  try {
    const ghResponse = await fetchWithTimeout(GITHUB_RELEASES_URL, {
      Accept: "application/vnd.github+json",
    });
    if (ghResponse.ok) {
      const releases: unknown = await ghResponse.json();
      if (Array.isArray(releases)) {
        for (const release of releases) {
          if (
            typeof release === "object" &&
            release !== null &&
            "tag_name" in release &&
            typeof release.tag_name === "string"
          ) {
            const match = RELEASE_TAG.exec(release.tag_name);
            if (match) return match[1];
          }
        }
      }
    }
  } catch {
    // Both sources failed
  }

  return null;
}

/**
 * Check for a newer CLI version in the background.
 * Prints a notification if a newer version is available.
 * Caches the result for 24 hours to avoid repeated network calls.
 */
export async function checkForUpdates(): Promise<void> {
  // Skip in CI, non-interactive, or if disabled
  if (process.env.CI || process.env.PGBEAM_NO_UPDATE_CHECK || !process.stderr.isTTY) {
    return;
  }

  try {
    const cached = readCache();

    // Use cached result if recent enough
    if (cached && Date.now() - cached.checkedAt < CHECK_INTERVAL_MS) {
      if (isNewer(VERSION, cached.latestVersion)) {
        printUpgradeNotice(cached.latestVersion);
      }
      return;
    }

    // Fetch in background, don't block CLI execution
    const latest = await fetchLatestVersion();
    if (!latest) return;

    writeCache({ latestVersion: latest, checkedAt: Date.now() });

    if (isNewer(VERSION, latest)) {
      printUpgradeNotice(latest);
    }
  } catch {
    // Never crash the CLI due to update checking
  }
}

function printUpgradeNotice(latestVersion: string): void {
  // Write to stderr to avoid corrupting --json stdout output
  const installHint =
    process.platform === "win32"
      ? `Run \`pgbeam update\` or \`irm https://pgbeam.com/install/windows | iex\``
      : `Run \`pgbeam update\` or \`curl -fsSL https://pgbeam.com/install | sh\``;
  const message = `Update available: ${VERSION} -> ${latestVersion}\n${installHint}`;
  consola.withTag("update").warn(message);
}
