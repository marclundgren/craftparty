#!/usr/bin/env bash
# Cross-compile headscale for Windows and publish the binaries as the
# `headscale-v<version>` release on this repo.
#
# Upstream (juanfont/headscale) stopped shipping Windows binaries, so the
# host app downloads Windows headscale from our mirror release instead.
# windows-abs-path.patch fixes upstream's absolute-path detection, which
# treats `C:\...` as relative on Windows (breaks noise key/sqlite paths).
#
# Requires: go, git, gh (authenticated with push access to this repo).
set -euo pipefail

VERSION="${1:-0.29.2}"
TAG="headscale-v${VERSION}"
REPO="marclundgren/craftparty"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

git clone --depth 1 --branch "v${VERSION}" \
  https://github.com/juanfont/headscale.git "$WORK/headscale"
git -C "$WORK/headscale" apply "$HERE/windows-abs-path.patch"

for arch in amd64 arm64; do
  (cd "$WORK/headscale" && CGO_ENABLED=0 GOOS=windows GOARCH="$arch" \
    go build -trimpath -ldflags "-s -w" \
    -o "$WORK/headscale_${VERSION}_windows_${arch}.exe" ./cmd/headscale)
done

(cd "$WORK" && sha256sum headscale_${VERSION}_windows_*.exe > checksums.txt)

gh release create "$TAG" --repo "$REPO" \
  --title "headscale v${VERSION} for Windows (mirror)" \
  --notes "Windows builds of [headscale v${VERSION}](https://github.com/juanfont/headscale/releases/tag/v${VERSION}) (BSD-3-Clause), which upstream no longer ships. Built with \`scripts/headscale-windows/build.sh\`; includes \`windows-abs-path.patch\` so absolute \`C:\\\` config paths resolve correctly. Used by the Craftparty host app on Windows." \
  "$WORK"/headscale_${VERSION}_windows_amd64.exe \
  "$WORK"/headscale_${VERSION}_windows_arm64.exe \
  "$WORK"/checksums.txt \
  "$HERE/windows-abs-path.patch"
