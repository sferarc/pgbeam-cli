import { chmodSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defineCommand } from "citty";
import { consola } from "consola";
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
const INSTALL_SCRIPT_URL = "https://pgbeam.com/install";
const IS_WINDOWS = process.platform === "win32";

/** The recognised update channels. */
const UPDATE_CHANNELS = ["latest", "dev"] as const;
type UpdateChannel = (typeof UPDATE_CHANNELS)[number];

/** Fetch the latest version from S3 or GitHub. */
async function fetchLatestVersion(): Promise<string | null> {
  try {
    const s3Response = await fetch(S3_LATEST_URL);
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
function detectAsset(): string {
  const os =
    process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const ext = IS_WINDOWS ? ".exe" : "";
  return `pgbeam-${os}-${arch}${ext}`;
}

/** Download a file from a URL. Returns the response body as an ArrayBuffer. */
async function downloadBinary(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }
  return res.arrayBuffer();
}

/** Install a binary by downloading it directly from S3. */
async function installFromS3(s3Path: string): Promise<void> {
  const asset = detectAsset();
  const url = `${S3_BASE}/${s3Path}/${asset}`;

  consola.start(`Downloading ${url}...`);
  const data = await downloadBinary(url);

  const ext = IS_WINDOWS ? ".exe" : "";
  const tmpFile = join(tmpdir(), `pgbeam-update-${Date.now()}${ext}`);
  writeFileSync(tmpFile, Buffer.from(data));

  if (!IS_WINDOWS) {
    chmodSync(tmpFile, 0o755);
  }

  const currentBin = process.execPath;

  if (IS_WINDOWS) {
    // On Windows, a running .exe can't be overwritten directly.
    // Rename current binary out of the way, move the new one in, then clean up.
    const dir = dirname(currentBin);
    const oldBin = join(dir, `pgbeam-old-${Date.now()}.exe`);
    renameSync(currentBin, oldBin);
    renameSync(tmpFile, currentBin);
    try {
      unlinkSync(oldBin);
    } catch {
      // Old binary may still be locked; it will be cleaned up on next update
    }
  } else {
    renameSync(tmpFile, currentBin);
  }

  consola.success(`Installed to ${currentBin}`);
}

export default defineCommand({
  meta: {
    name: "update",
    description: "Update the PgBeam CLI to the latest version",
    icon: "RefreshCw",
    docs: {
      longDescription:
        "Check for and install CLI updates. By default, checks the latest stable release and prompts before updating. Use `--channel dev` with `--version` to install development builds (e.g. PR preview builds). The binary is downloaded from S3 and replaces the current installation in-place.",
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

      if (!args.yes) {
        const { confirm } = await import("@inquirer/prompts");
        const proceed = await confirm({
          message: `Install dev build ${args.version}?`,
          default: true,
        });
        if (!proceed) {
          consola.info("Update cancelled.");
          return;
        }
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
      await installFromS3(`v${targetVersion}`);
    } catch {
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
