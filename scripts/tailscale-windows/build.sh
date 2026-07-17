#!/usr/bin/env bash
# Cross-compile tailscaled + tailscale for Windows and publish them as the
# `tailscale-v<version>` release on this repo.
#
# The host app runs tailscaled per-user without elevation. Upstream's
# named-pipe security descriptor sets owner=Administrators, which only
# works elevated/as a service; tailscale-unelevated-pipe.patch uses the
# creator's default security instead (same downgrade upstream's own tests
# apply to run unelevated).
#
# Requires: go, git, gh (authenticated with push access to this repo).
set -euo pipefail

VERSION="${1:-1.98.9}"
TAG="tailscale-v${VERSION}"
REPO="marclundgren/craftparty"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

git clone --depth 1 --branch "v${VERSION}" \
  https://github.com/tailscale/tailscale.git "$WORK/tailscale"
git -C "$WORK/tailscale" apply "$HERE/tailscale-unelevated-pipe.patch"

for arch in amd64 arm64; do
  for cmd in tailscaled tailscale; do
    (cd "$WORK/tailscale" && CGO_ENABLED=0 GOOS=windows GOARCH="$arch" \
      go build -trimpath -ldflags "-s -w" \
      -o "$WORK/${cmd}_${VERSION}_windows_${arch}.exe" "./cmd/${cmd}")
  done
done

(cd "$WORK" && sha256sum ./*_windows_*.exe > checksums.txt)

gh release create "$TAG" --repo "$REPO" --prerelease \
  --title "tailscale v${VERSION} for Windows (unelevated, mirror)" \
  --notes "Windows builds of tailscale v${VERSION} (BSD-3-Clause) for the Craftparty host app; see scripts/tailscale-windows/." \
  "$WORK"/*_windows_*.exe "$WORK/checksums.txt" \
  "$HERE/tailscale-unelevated-pipe.patch"
