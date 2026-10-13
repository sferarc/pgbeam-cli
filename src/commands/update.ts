import { createHash } from "node:crypto";
import { copyFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defineCommand } from "citty";
import { consola } from "consola";
import { ConfirmationDeclinedError, confirmDestructive } from "../lib/confirm.js";
import { VERSION } from "../lib/constants.js";
import { globalArgs } from "../lib/flags.js";
import { isNewer, parseSemver } from "../lib/semver.js";

const S3_BASE = "https://pgbeam-releases.s3.amazonaws.com/cli";
const S3_LATEST_URL = `${S3_BASE}/latest/version.txt`;
/**
 * The public CLI repository. It was `sferarc/pgbeam` (the private monorepo),
 * which 404s for anyone outside the org, so this fallback never worked.
 */
const GITHUB_RELEASES_URL = "https://api.github.com/repos/sferarc/pgbeam-cli/releases";
/** Release tags on the CLI repository are `vX.Y.Z`, matching the npm version. */
const RELEASE_TAG = /^v(\d+\.\d+\.\d+.*)$/;
/** Each stable release carries `SHA256SUMS` (sha256sum output) over the S3 binaries. */
const GITHUB_DOWNLOAD_BASE = "https://github.com/sferarc/pgbeam-cli/releases/download";
const INSTALL_SCRIPT_URL = "https://pgbeam.com/install";
const METADATA_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 300_000;
const IS_WINDOWS = process.platform === "win32";

/** The recognised update channels. */
const UPDATE_CHANNELS = ["latest", "dev"] as const;
type UpdateChannel = (typeof UPDATE_CHANNELS)[number];

/** Fetch the latest version from S3 or GitHub. */
async function fetchLatestVersion(): Promise<string | null> {
  try {
    const s3Response = await fetch(S3_LATEST_URL, {
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    });
    if (s3Response.ok) {
      const text = await s3Response.text();
      const version = text.trim().replace(/^v/, "");
      if (parseSemver(version)) return version;
    }
  } catch {
    // Fall through to GitHub
  }

  try {
    const ghResponse = await fetch(GITHUB_RELEASES_URL, {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
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
    // Both failed
  }

  return null;
}

/** Detect the platform asset name. */
export function detectAsset(): string {
  const os =
    process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const ext = IS_WINDOWS ? ".exe" : "";
  return `pgbeam-${os}-${arch}${ext}`;
}

/** The download could not be verified against the published checksums. */
export class IntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrityError";
  }
}

/** The directory holding the current binary is not writable by this user. */
export class InstallPermissionError extends Error {
  constructor(target: string) {
    super(
      `Cannot replace ${target}: permission denied. Re-run with sudo, or reinstall with: curl -fsSL ${INSTALL_SCRIPT_URL} | sh`,
    );
    this.name = "InstallPermissionError";
  }
}

function errorCode(err: unknown): string | undefined {
  return err && typeof err === "object" && "code" in err ? String(err.code) : undefined;
}

function isPermissionError(err: unknown): boolean {
  const code = errorCode(err);
  return code === "EACCES" || code === "EPERM" || code === "EROFS";
}

function removeQuietly(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Already gone, or locked on Windows until the next update.
  }
}

/** Fetch the expected sha256 of `asset` from the release's SHA256SUMS. */
export async function fetchExpectedChecksum(version: string, asset: string): Promise<string> {
  const url = `${GITHUB_DOWNLOAD_BASE}/v${version}/SHA256SUMS`;
  let text: string;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(METADATA_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    text = await res.text();
  } catch (err) {
    throw new IntegrityError(
      `Could not fetch checksums from ${url} (${err instanceof Error ? err.message : err}). Refusing to install an unverified binary.`,
    );
  }
  for (const line of text.split("\n")) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(\S+)\s*$/.exec(line);
    if (match && match[2] === asset) return match[1].toLowerCase();
  }
  throw new IntegrityError(
    `SHA256SUMS for v${version} has no entry for ${asset}. Refusing to install an unverified binary.`,
  );
}

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Move a file, copying when source and destination are on different filesystems. */
export function moveFile(src: string, dest: string): void {
  try {
    renameSync(src, dest);
    return;
  } catch (err) {
    if (errorCode(err) !== "EXDEV") throw err;
  }
  const staged = `${dest}.pgbeam-update`;
  try {
    copyFileSync(src, staged);
    renameSync(staged, dest);
  } catch (err) {
    removeQuietly(staged);
    throw err;
  }
  removeQuietly(src);
}

/**
 * Write the new binary next to `target` so the final rename stays on one
 * filesystem; fall back to tmpdir when that directory refuses the write.
 */
function stageBinary(data: Uint8Array, target: string): string {
  const name = `.pgbeam-update-${process.pid}-${Date.now()}${IS_WINDOWS ? ".exe" : ""}`;
  const besideTarget = join(dirname(target), name);
  try {
    writeFileSync(besideTarget, data, { mode: 0o755 });
    return besideTarget;
  } catch (err) {
    if (!isPermissionError(err)) throw err;
  }
  const inTmp = join(tmpdir(), name);
  writeFileSync(inTmp, data, { mode: 0o755 });
  return inTmp;
}

function replaceBinary(staged: string, target: string): void {
  if (!IS_WINDOWS) {
    moveFile(staged, target);
    return;
  }
  // A running .exe cannot be overwritten, but it can be renamed out of the way.
  const oldBin = join(dirname(target), `pgbeam-old-${Date.now()}.exe`);
  renameSync(target, oldBin);
  try {
    moveFile(staged, target);
  } catch (err) {
    renameSync(oldBin, target);
    throw err;
  }
  removeQuietly(oldBin);
}

interface InstallOptions {
  /** Stable release version whose SHA256SUMS must match the download. Omit for dev builds. */
  verifyVersion?: string;
  /** Defaults to the running binary. */
  target?: string;
}

/** Install a binary by downloading it directly from S3. */
export async function installFromS3(s3Path: string, opts: InstallOptions = {}): Promise<void> {
  const asset = detectAsset();
  const url = `${S3_BASE}/${s3Path}/${asset}`;
  const target = opts.target ?? process.execPath;

  const expected =
    opts.verifyVersion === undefined
      ? undefined
      : await fetchExpectedChecksum(opts.verifyVersion, asset);

  consola.start(`Downloading ${url}...`);
  const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }
  const data = new Uint8Array(await res.arrayBuffer());

  if (expected !== undefined) {
    const actual = sha256(data);
    if (actual !== expected) {
      throw new IntegrityError(
        `Checksum mismatch for ${asset}: expected ${expected}, got ${actual}. The download was discarded.`,
      );
    }
    consola.success("Checksum verified against SHA256SUMS.");
  }

  let staged: string | undefined;
  try {
    staged = stageBinary(data, target);
    replaceBinary(staged, target);
    staged = undefined;
  } catch (err) {
    if (isPermissionError(err)) throw new InstallPermissionError(target);
    throw err;
  } finally {
    if (staged !== undefined) removeQuietly(staged);
  }

  consola.success(`Installed to ${target}`);
}

export default defineCommand({
  meta: {
    name: "update",
    description: "Update the PgBeam CLI to the latest version",
    icon: "RefreshCw",
    docs: {
      longDescription:
        "Check for and install CLI updates. By default, checks the latest stable release and prompts before updating. Use `--channel dev` with `--version` to install development builds (e.g. PR preview builds). The binary is downloaded from S3, checked against the release's SHA256SUMS (dev builds are unverified and need confirmation), and replaces the current installation in-place.",
      examples: [
        { comment: "Check for updates and install if available", command: "pgbeam update" },
        { comment: "Update without confirmation prompt", command: "pgbeam update --yes" },
        { comment: "Install a specific version", command: "pgbeam update --version 1.2.3" },
        {
          comment: "Install a dev build from a PR",
          command: "pgbeam update --channel dev --version pr-434",
        },
      ],
      response:
        "Shows the current and target version. If already on the latest version, prints a success message. Otherwise, prompts for confirmation (unless `--yes`), downloads the new binary, and confirms the installation.",
    },
  },
  args: {
    ...globalArgs,
    yes: {
      type: "boolean",
      alias: "y",
      description: "Skip the confirmation prompt before updating",
      default: false,
    },
    channel: {
      type: "string",
      description: "Update channel to use: latest (stable releases) or dev (PR preview builds)",
      default: "latest",
    },
    version: {
      type: "string",
      description:
        "Specific version to install. Required for the dev channel (e.g. pr-434). Optional for latest channel (e.g. 1.2.3).",
    },
  },
  async run({ args }) {
    const rawChannel = String(args.channel ?? "latest");
    if (!(UPDATE_CHANNELS as readonly string[]).includes(rawChannel)) {
      consola.error(
        `Unknown --channel "${rawChannel}". Use one of: ${UPDATE_CHANNELS.join(", ")}.`,
      );
      process.exit(1);
    }
    const channel = rawChannel as UpdateChannel;

    // Dev channel: download directly from S3 PR path
    if (channel === "dev") {
      if (!args.version) {
        consola.error("--version is required for the dev channel (e.g. --version pr-434)");
        process.exit(1);
      }

      consola.info(`Current version: ${VERSION}`);
      consola.info(`Installing dev build: ${args.version}`);

      consola.warn("Dev builds have no published checksums, so this download cannot be verified.");

      try {
        await confirmDestructive({
          yes: Boolean(args.yes),
          message: `Install unverified dev build ${args.version}?`,
          action: "Installing an unverified dev build",
        });
      } catch (err) {
        if (err instanceof ConfirmationDeclinedError) {
          consola.info("Update cancelled.");
          return;
        }
        consola.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      try {
        await installFromS3(args.version as string);
      } catch (err) {
        consola.error(`Failed to install dev build: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
      return;
    }

    // Latest channel (default)
    consola.start("Checking for updates...");

    let targetVersion: string;

    if (args.version) {
      // Explicit version requested
      targetVersion = (args.version as string).replace(/^v/, "");
    } else {
      const latest = await fetchLatestVersion();
      if (!latest) {
        consola.error("Failed to check for updates. Check your internet connection.");
        process.exit(1);
      }
      targetVersion = latest;
    }

    consola.info(`Current version: ${VERSION}`);
    consola.info(`Target version:  ${targetVersion}`);

    if (!args.version && !isNewer(VERSION, targetVersion)) {
      consola.success("You are already on the latest version.");
      return;
    }

    consola.log("");

    if (!args.yes) {
      const { confirm } = await import("@inquirer/prompts");
      const proceed = await confirm({
        message: `Update from ${VERSION} to ${targetVersion}?`,
        default: true,
      });
      if (!proceed) {
        consola.info("Update cancelled.");
        return;
      }
    }

    try {
      await installFromS3(`v${targetVersion}`, { verifyVersion: targetVersion });
    } catch (err) {
      // The install script does not verify checksums, so it is no fallback here.
      if (err instanceof IntegrityError || err instanceof InstallPermissionError) {
        consola.error(err.message);
        process.exit(1);
      }
      if (IS_WINDOWS) {
        consola.error("Update failed. Download manually from:");
        consola.log(`  ${S3_BASE}/v${targetVersion}/${detectAsset()}`);
        process.exit(1);
      }

      // Fall back to install script (Unix only)
      consola.start("Trying install script...");
      const { execSync } = await import("node:child_process");
      try {
        execSync(`curl -fsSL ${INSTALL_SCRIPT_URL} | sh`, {
          stdio: "inherit",
          env: { ...process.env, PGBEAM_VERSION: targetVersion },
        });
        consola.success(`Updated to ${targetVersion}`);
      } catch {
        consola.error("Update failed. Try running manually:");
        consola.log(`  curl -fsSL ${INSTALL_SCRIPT_URL} | sh`);
        process.exit(1);
      }
    }
  },
});
