#!/bin/sh
set -e

# Build the PgBeam CLI native binaries for every supported platform.
# Requires: bun
#
# These are what the Homebrew tap and the install script download. The npm
# package is a different artifact built by a different command (`pnpm build`,
# bunchee), because a bun-compiled binary is not something npm can install and
# a Node bundle is not something Homebrew can pour.
#
# Usage: build-all.sh [output-dir]
#
# The optional output directory lets the release workflow collect the binaries
# and the checksum file somewhere it controls without copying them afterwards.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_DIR="$(dirname "$SCRIPT_DIR")"
DIST_DIR="${1:-${CLI_DIR}/dist}"

mkdir -p "$DIST_DIR"

# Read version from package.json
VERSION=$(node -p "require('${CLI_DIR}/package.json').version")

echo "Building PgBeam CLI v${VERSION}..."

TARGETS="bun-darwin-arm64 bun-darwin-x64 bun-linux-x64 bun-linux-arm64 bun-windows-x64"

for TARGET in $TARGETS; do
  PLATFORM=$(echo "$TARGET" | sed 's/bun-//')
  OUTPUT="${DIST_DIR}/pgbeam-${PLATFORM}"

  # Append .exe for Windows targets
  case "$TARGET" in
    *windows*) OUTPUT="${OUTPUT}.exe" ;;
  esac

  echo "  Building ${OUTPUT}..."
  bun build --compile --target="$TARGET" --define "__PGBEAM_VERSION__='${VERSION}'" "${CLI_DIR}/src/bin/pgbeam.ts" --outfile "$OUTPUT"
done

# Write version file (used by upgrade notifier)
echo "$VERSION" > "${DIST_DIR}/version.txt"

# Checksums, in the format `shasum -c` and Homebrew both read. The tap pins
# each binary by sha256, so this file is the release's source of truth for
# those values rather than something recomputed by hand later.
(
  cd "$DIST_DIR"
  # `shasum -a 256` is present on macOS and on the Linux runner image;
  # `sha256sum` is Linux-only, so prefer the portable one and fall back.
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 pgbeam-* > SHA256SUMS
  else
    sha256sum pgbeam-* > SHA256SUMS
  fi
)

echo ""
echo "Build complete (v${VERSION}). Binaries in ${DIST_DIR}/"
ls -la "$DIST_DIR"/pgbeam-*
cat "${DIST_DIR}/SHA256SUMS"
